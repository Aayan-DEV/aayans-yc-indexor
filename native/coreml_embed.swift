// Long-running Core ML helper for MobileCLIP-S0. One process stays warm, so each request costs milliseconds.
// Protocol: one JSON object per line on stdin, one JSON reply per line on stdout.
//   {"id":1,"op":"image","path":"/abs/file.webp"} -> {"id":1,"ok":true,"embedding":[512 floats],"colorText":"...","colors":[..],"letters":"...","ms":12.3}
//   {"id":3,"op":"ocr","path":"/abs/file.webp"}   -> {"id":3,"ok":true,"letters":"the words printed in the picture","ms":41.2}
//   {"id":2,"op":"text","tokens":[77 ints]}        -> {"id":2,"ok":true,"embedding":[512 floats],"ms":7.9}
import CoreGraphics
import CoreML
import Foundation
import ImageIO
import Vision

func loadModel(_ package: String) throws -> MLModel {
    // Compiling the package takes about a second, so the compiled form is kept next to it for later starts.
    let compiledURL = URL(fileURLWithPath: package.replacingOccurrences(of: ".mlpackage", with: ".mlmodelc"))
    if !FileManager.default.fileExists(atPath: compiledURL.path) {
        let temp = try MLModel.compileModel(at: URL(fileURLWithPath: package))
        try? FileManager.default.removeItem(at: compiledURL)
        try FileManager.default.copyItem(at: temp, to: compiledURL)
    }
    let config = MLModelConfiguration()
    config.computeUnits = .all
    return try MLModel(contentsOf: compiledURL, configuration: config)
}

/// Draws the image into a square BGRA buffer. `cover` crops the center so photos are not squashed.
func squareBuffer(_ img: CGImage, side: Int) -> (CVPixelBuffer, UnsafeMutablePointer<UInt8>, Int)? {
    var buffer: CVPixelBuffer?
    CVPixelBufferCreate(kCFAllocatorDefault, side, side, kCVPixelFormatType_32BGRA,
                        [kCVPixelBufferCGImageCompatibilityKey: true, kCVPixelBufferCGBitmapContextCompatibilityKey: true] as CFDictionary, &buffer)
    guard let pb = buffer else { return nil }
    CVPixelBufferLockBaseAddress(pb, [])
    defer { CVPixelBufferUnlockBaseAddress(pb, []) }
    guard let base = CVPixelBufferGetBaseAddress(pb) else { return nil }
    let ctx = CGContext(data: base, width: side, height: side, bitsPerComponent: 8, bytesPerRow: CVPixelBufferGetBytesPerRow(pb),
                        space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue)
    ctx?.interpolationQuality = .high
    let w = CGFloat(img.width), h = CGFloat(img.height), s = CGFloat(side) / min(w, h)
    // Logos often have a see-through background. Put them on white, the way they are normally shown, not on leftover memory.
    ctx?.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
    ctx?.fill(CGRect(x: 0, y: 0, width: side, height: side))
    ctx?.draw(img, in: CGRect(x: (CGFloat(side) - w * s) / 2, y: (CGFloat(side) - h * s) / 2, width: w * s, height: h * s))
    return (pb, base.assumingMemoryBound(to: UInt8.self), CVPixelBufferGetBytesPerRow(pb))
}

// Color words the way people say them. Same naming rules as the Python indexer (indexer/describe.py).
let hues: [(Double, String)] = [(12, "red"), (38, "orange"), (52, "yellow-orange"), (66, "yellow"), (88, "yellow-green (lime)"), (160, "green"),
                                (178, "green-blue (teal)"), (198, "light blue (cyan)"), (236, "blue"), (268, "blue-purple (indigo)"), (295, "purple"),
                                (335, "pink"), (350, "pink-red"), (361, "red")]

func colorName(_ r: Double, _ g: Double, _ b: Double) -> String {
    let mx = max(r, g, b), mn = min(r, g, b), v = mx, d = mx - mn
    let s = mx == 0 ? 0 : d / mx
    var h = 0.0
    if d > 0 {
        if mx == r { h = ((g - b) / d).truncatingRemainder(dividingBy: 6) } else if mx == g { h = (b - r) / d + 2 } else { h = (r - g) / d + 4 }
        h *= 60
        if h < 0 { h += 360 }
    }
    if v < 0.2 { return "black" }
    if s < 0.14 {
        if v > 0.75 && s >= 0.045 && h >= 15 && h <= 70 { return "cream or beige" }
        return v > 0.84 ? "white" : v > 0.6 ? "light gray" : v > 0.35 ? "gray" : "dark gray"
    }
    let base = hues.first { h < $0.0 }!.1
    if (base == "orange" || base == "yellow-orange") && v < 0.55 { return "brown" }
    return (v < 0.5 ? "dark " : (s < 0.38 && v > 0.78 ? "pale " : "")) + base
}

func colorWords(_ img: CGImage) -> (String, [String]) {
    let n = 48
    guard let (_, px, stride) = squareBuffer(img, side: n) else { return ("", []) }
    var counts: [String: Int] = [:], ring: [String: Int] = [:], center: [String: Int] = [:]
    var brightness = 0.0
    for y in 0..<n {
        for x in 0..<n {
            let o = y * stride + x * 4
            let b = Double(px[o]) / 255, g = Double(px[o + 1]) / 255, r = Double(px[o + 2]) / 255
            let name = colorName(r, g, b)
            counts[name, default: 0] += 1
            brightness += (r + g + b) / 3
            if x == 2 || x == n - 3 || y == 2 || y == n - 3 { ring[name, default: 0] += 1 }
            if (16..<32).contains(x) && (16..<32).contains(y) { center[name, default: 0] += 1 }
        }
    }
    let total = Double(n * n)
    let main = counts.sorted { $0.value > $1.value }.prefix(6).filter { Double($0.value) / total >= 0.04 }
    let tone = brightness / total < 0.3 ? "dark overall" : brightness / total > 0.72 ? "light overall" : "medium brightness"
    let background = ring.max { $0.value < $1.value }?.key ?? "unknown"
    let middle = center.sorted { $0.value > $1.value }.prefix(2).map { $0.key }.joined(separator: " and ")
    let text = "Colors by area: " + main.map { "\($0.key) \(Int((Double($0.value) / total * 100).rounded()))%" }.joined(separator: ", ")
        + ". The background (outer edge) is \(background). The middle of the image is mostly \(middle). The image is \(tone)."
    return (text, main.prefix(3).map { $0.key })
}

func vector(_ out: MLFeatureProvider) -> [Float] {
    for name in out.featureNames {
        if let a = out.featureValue(for: name)?.multiArrayValue {
            var v = (0..<a.count).map { a[$0].floatValue }
            let norm = sqrt(v.reduce(0) { $0 + $1 * $1 })
            if norm > 0 { v = v.map { $0 / norm } }  // unit length, so a dot product is the cosine similarity
            return v
        }
    }
    return []
}

/**
 * The words printed inside a picture. The image model cannot read: it scores "a logo with letters in it" at chance,
 * so text has to come from somewhere else. Vision reads it locally and free. Logos are small and their type is
 * stylised, so the picture is put on white and blown up to 640 px first, keeping its shape, and language correction
 * is off because a logo is a name, not a sentence. Only Vision's careful pass is used: its quick one does read the
 * odd single stylised glyph the careful one skips, but it also reads a '7' out of the DoorDash mark and an '&J' out of
 * Airbnb's, and inventing writing is worse than missing it.
 */
func readLetters(_ img: CGImage) -> String {
    let side = 640
    guard let ctx = CGContext(data: nil, width: side, height: side, bitsPerComponent: 8, bytesPerRow: 0,
                              space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { return "" }
    ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
    ctx.fill(CGRect(x: 0, y: 0, width: side, height: side))
    ctx.interpolationQuality = .high
    let scale = min(Double(side) / Double(img.width), Double(side) / Double(img.height))
    let w = Double(img.width) * scale, h = Double(img.height) * scale
    ctx.draw(img, in: CGRect(x: (Double(side) - w) / 2, y: (Double(side) - h) / 2, width: w, height: h))
    guard let big = ctx.makeImage() else { return "" }
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = false
    request.minimumTextHeight = 0.04
    try? VNImageRequestHandler(cgImage: big, options: [:]).perform([request])
    let found = (request.results ?? []).compactMap { $0.topCandidates(1).first }.filter { $0.confidence >= 0.3 }.map { $0.string }
    return found.joined(separator: " ").trimmingCharacters(in: .whitespacesAndNewlines)
}

func reply(_ obj: [String: Any]) {
    print(String(data: try! JSONSerialization.data(withJSONObject: obj), encoding: .utf8)!)
    fflush(stdout)
}

let dir = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "models"
let imageModel = try loadModel("\(dir)/mobileclip_s0_image.mlpackage")
let textModel = try loadModel("\(dir)/mobileclip_s0_text.mlpackage")
let imageInput = imageModel.modelDescription.inputDescriptionsByName.keys.first!
let textInput = textModel.modelDescription.inputDescriptionsByName.keys.first!
let side = imageModel.modelDescription.inputDescriptionsByName[imageInput]?.imageConstraint?.pixelsWide ?? 256
reply(["ready": true])

while let line = readLine() {
    guard let data = line.data(using: .utf8), let req = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { continue }
    let id = req["id"] ?? 0
    let t0 = Date()
    do {
        if req["op"] as? String == "image", let path = req["path"] as? String {
            guard let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil), let img = CGImageSourceCreateImageAtIndex(src, 0, nil),
                  let (pb, _, _) = squareBuffer(img, side: side) else { reply(["id": id, "ok": false, "error": "cannot read image"]); continue }
            let out = try imageModel.prediction(from: MLDictionaryFeatureProvider(dictionary: [imageInput: MLFeatureValue(pixelBuffer: pb)]))
            let (text, top) = colorWords(img)
            reply(["id": id, "ok": true, "embedding": vector(out), "colorText": text, "colors": top, "letters": readLetters(img), "ms": Date().timeIntervalSince(t0) * 1000])
        } else if req["op"] as? String == "ocr", let path = req["path"] as? String {
            guard let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil), let img = CGImageSourceCreateImageAtIndex(src, 0, nil)
            else { reply(["id": id, "ok": false, "error": "cannot read image"]); continue }
            reply(["id": id, "ok": true, "letters": readLetters(img), "ms": Date().timeIntervalSince(t0) * 1000])
        } else if req["op"] as? String == "text", let tokens = req["tokens"] as? [Int] {
            let arr = try MLMultiArray(shape: [1, NSNumber(value: tokens.count)], dataType: .int32)
            for (i, v) in tokens.enumerated() { arr[i] = NSNumber(value: v) }
            let out = try textModel.prediction(from: MLDictionaryFeatureProvider(dictionary: [textInput: MLFeatureValue(multiArray: arr)]))
            reply(["id": id, "ok": true, "embedding": vector(out), "ms": Date().timeIntervalSince(t0) * 1000])
        } else {
            reply(["id": id, "ok": false, "error": "unknown op"])
        }
    } catch {
        reply(["id": id, "ok": false, "error": "\(error)"])
    }
}
