import Foundation
import AVFoundation
import Photos

private struct CutSection: Decodable {
    let startMs: UInt64
    let endMs: UInt64
}

private func writeError(_ message: String, to buffer: UnsafeMutablePointer<CChar>?, maxLen: Int) {
    guard let buffer = buffer, maxLen > 1 else { return }
    let bytes = Array(message.utf8.prefix(maxLen - 1))
    for (idx, byte) in bytes.enumerated() {
        buffer[idx] = CChar(bitPattern: byte)
    }
    buffer[bytes.count] = 0
}

private func makeAsset(url: URL, userAgent: String) -> AVURLAsset {
    if userAgent.isEmpty {
        return AVURLAsset(url: url)
    }
    return AVURLAsset(url: url, options: ["AVURLAssetHTTPHeaderFieldsKey": ["User-Agent": userAgent]])
}

/// Hardware-accelerated on-device trim & multi-cut merge using iOS AVFoundation.
/// Supports progressive MP4, Twitch HLS `.m3u8`, and dual-track compositions,
/// saving outputs to Files (Documents/Cutline) and Photos (Camera Roll).
@_cdecl("cutline_ios_export_clip")
public func cutline_ios_export_clip(
    _ videoUrlPtr: UnsafePointer<CChar>?,
    _ audioUrlPtr: UnsafePointer<CChar>?,
    _ userAgentPtr: UnsafePointer<CChar>?,
    _ sectionsJsonPtr: UnsafePointer<CChar>?,
    _ outputPathPtr: UnsafePointer<CChar>?,
    _ formatPtr: UnsafePointer<CChar>?,
    _ saveToPhotos: Bool,
    _ errorBuf: UnsafeMutablePointer<CChar>?,
    _ errorBufLen: Int
) -> Int32 {
    guard
        let videoUrlPtr = videoUrlPtr,
        let sectionsJsonPtr = sectionsJsonPtr,
        let outputPathPtr = outputPathPtr,
        let formatPtr = formatPtr
    else {
        writeError("Missing required export arguments.", to: errorBuf, maxLen: errorBufLen)
        return 1
    }

    let videoUrlStr = String(cString: videoUrlPtr)
    let audioUrlStr = audioUrlPtr.map { String(cString: $0) } ?? ""
    let userAgent = userAgentPtr.map { String(cString: $0) } ?? ""
    let sectionsJson = String(cString: sectionsJsonPtr)
    let outputPath = String(cString: outputPathPtr)
    let format = String(cString: formatPtr).lowercased()

    guard let videoURL = URL(string: videoUrlStr) else {
        writeError("Invalid video stream URL.", to: errorBuf, maxLen: errorBufLen)
        return 2
    }
    let audioURL = !audioUrlStr.isEmpty ? URL(string: audioUrlStr) : nil

    guard let data = sectionsJson.data(using: .utf8),
          let sections = try? JSONDecoder().decode([CutSection].self, from: data),
          !sections.isEmpty else {
        writeError("Invalid cut sections payload.", to: errorBuf, maxLen: errorBufLen)
        return 3
    }

    let outputURL = URL(fileURLWithPath: outputPath)
    let fm = FileManager.default
    try? fm.createDirectory(at: outputURL.deletingLastPathComponent(), withIntermediateDirectories: true)
    if fm.fileExists(atPath: outputURL.path) {
        try? fm.removeItem(at: outputURL)
    }

    let audioOnly = (format == "mp3" || format == "m4a")
    let videoAsset = makeAsset(url: videoURL, userAgent: userAgent)
    let audioAsset = audioURL.map { makeAsset(url: $0, userAgent: userAgent) } ?? videoAsset
    let composition = AVMutableComposition()

    let sem = DispatchSemaphore(value: 0)
    var exitCode: Int32 = 0
    var errorMessage: String = ""

    Task {
        do {
            let duration = try await (audioOnly ? audioAsset : videoAsset).load(.duration)
            let videoTracks = audioOnly ? [] : try await videoAsset.loadTracks(withMediaType: .video)
            let audioTracks = try await audioAsset.loadTracks(withMediaType: .audio)

            let compVideo = videoTracks.first != nil
                ? composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid)
                : nil
            let compAudio = audioTracks.first != nil
                ? composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid)
                : nil

            var cursor = CMTime.zero
            for sec in sections {
                let start = CMTime(value: Int64(sec.startMs), timescale: 1000)
                let end = min(CMTime(value: Int64(sec.endMs), timescale: 1000), duration)
                if end <= start { continue }
                let range = CMTimeRange(start: start, end: end)

                if let srcV = videoTracks.first, let dstV = compVideo {
                    try dstV.insertTimeRange(range, of: srcV, at: cursor)
                }
                if let srcA = audioTracks.first, let dstA = compAudio {
                    try dstA.insertTimeRange(range, of: srcA, at: cursor)
                }
                cursor = CMTimeAdd(cursor, range.duration)
            }

            let preferredPreset = audioOnly
                ? AVAssetExportPresetAppleM4A
                : AVAssetExportPresetHighestQuality
            guard let exporter = AVAssetExportSession(asset: composition, presetName: preferredPreset) else {
                errorMessage = "Could not initialize AVAssetExportSession."
                exitCode = 4
                sem.signal()
                return
            }

            exporter.outputURL = outputURL
            exporter.outputFileType = audioOnly ? .m4a : .mp4
            exporter.shouldOptimizeForNetworkUse = true

            await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
                exporter.exportAsynchronously {
                    continuation.resume()
                }
            }

            switch exporter.status {
            case .completed:
                if saveToPhotos && !audioOnly {
                    let status = await PHPhotoLibrary.requestAuthorization(for: .addOnly)
                    if status == .authorized || status == .limited {
                        try? await PHPhotoLibrary.shared().performChanges {
                            PHAssetChangeRequest.creationRequestForAssetFromVideo(atFileURL: outputURL)
                        }
                    }
                }
                exitCode = 0
            case .cancelled:
                errorMessage = "Export cancelled."
                exitCode = 5
            default:
                errorMessage = exporter.error?.localizedDescription ?? "AVFoundation export failed."
                exitCode = 6
            }
        } catch {
            errorMessage = error.localizedDescription
            exitCode = 7
        }
        sem.signal()
    }

    sem.wait()
    if exitCode != 0 {
        writeError(errorMessage, to: errorBuf, maxLen: errorBufLen)
    }
    return exitCode
}
