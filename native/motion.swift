// Streams the MacBook's built-in accelerometer, gyro and lid angle to the page as server-sent events.
//
// Apple Silicon MacBooks have a motion sensor behind the sensor processing unit. No public API exposes it and
// browsers get no motion events on macOS, but it shows up as HID devices (vendor page 0xFF00: usage 3 = accel,
// usage 9 = gyro; sensor page 0x20, usage 138 = lid angle). They usually open without root; some Macs need sudo.
//
//   npm run build:motion && native/motion
//
// It listens on 127.0.0.1:3917 only, and only answers pages served from localhost.
import Foundation
import IOKit
import IOKit.hid
import Network

let PORT: UInt16 = 3917
var accel = (x: 0.0, y: 0.0, z: 0.0, n: 0.0)
var gyro = (x: 0.0, y: 0.0, z: 0.0, n: 0.0)
var lastAccel = [0.0, 0.0, -1.0]
var lid: Int? = nil
var reports = 0
var clients: [NWConnection] = []

func say(_ text: String) { FileHandle.standardError.write((text + "\n").data(using: .utf8)!) }

/// The sensors sleep until their driver is told to report. 1000 microseconds between reports = about 1 kHz.
func wakeSensors() -> Int {
    var iterator: io_iterator_t = 0
    guard IOServiceGetMatchingServices(kIOMainPortDefault, IOServiceMatching("AppleSPUHIDDriver"), &iterator) == KERN_SUCCESS else { return 0 }
    var count = 0
    var service = IOIteratorNext(iterator)
    while service != 0 {
        for (key, value) in [("SensorPropertyReportingState", 1), ("SensorPropertyPowerState", 1), ("ReportInterval", 1000)] {
            IORegistryEntrySetCFProperty(service, key as CFString, value as CFNumber)
        }
        count += 1
        IOObjectRelease(service)
        service = IOIteratorNext(iterator)
    }
    IOObjectRelease(iterator)
    return count
}

/// Motion reports are 22 bytes: x, y, z as little-endian int32 at bytes 6, 10 and 14, in 1/65536 g or degrees/second.
func axis(_ report: UnsafeMutablePointer<UInt8>, _ offset: Int) -> Double {
    var raw: Int32 = 0
    memcpy(&raw, report + offset, 4)
    return Double(Int32(littleEndian: raw)) / 65536.0
}

let onReport: IOHIDReportCallback = { _, _, sender, _, _, report, length in
    guard let sender = sender else { return }
    let device = Unmanaged<IOHIDDevice>.fromOpaque(sender).takeUnretainedValue()
    let page = IOHIDDeviceGetProperty(device, kIOHIDPrimaryUsagePageKey as CFString) as? Int ?? 0
    let usage = IOHIDDeviceGetProperty(device, kIOHIDPrimaryUsageKey as CFString) as? Int ?? 0
    reports += 1
    if page == 0xFF00 && length >= 18 {
        let (x, y, z) = (axis(report, 6), axis(report, 10), axis(report, 14))
        if usage == 3 { accel = (accel.x + x, accel.y + y, accel.z + z, accel.n + 1) }
        if usage == 9 { gyro = (gyro.x + x, gyro.y + y, gyro.z + z, gyro.n + 1) }
    } else if page == 0x20 && usage == 138 && length >= 3 {
        lid = Int(UInt16(report[1]) | (UInt16(report[2]) << 8)) & 0x1FF
    }
}

let woken = wakeSensors()
let manager = IOHIDManagerCreate(kCFAllocatorDefault, IOOptionBits(kIOHIDOptionsTypeNone))
let wanted = [(0xFF00, 3), (0xFF00, 9), (0x20, 138)].map { [kIOHIDDeviceUsagePageKey: $0.0, kIOHIDDeviceUsageKey: $0.1] }
IOHIDManagerSetDeviceMatchingMultiple(manager, wanted as CFArray)
IOHIDManagerRegisterInputReportCallback(manager, onReport, nil)
IOHIDManagerScheduleWithRunLoop(manager, CFRunLoopGetMain(), CFRunLoopMode.defaultMode.rawValue)
let opened = IOHIDManagerOpen(manager, IOOptionBits(kIOHIDOptionsTypeNone))
let found = (IOHIDManagerCopyDevices(manager) as? Set<IOHIDDevice>)?.count ?? 0
say("sensor drivers woken: \(woken) | devices matched: \(found) | open: \(opened == kIOReturnSuccess ? "ok" : String(format: "failed 0x%08x", opened))")
if opened != kIOReturnSuccess {
    say("The motion sensor could not be opened. On some Macs this needs root: sudo native/motion")
    exit(1)
}

/// Only pages served from this machine may read the sensor, even though the port is already loopback-only.
func isLocal(_ request: String) -> Bool {
    guard let line = request.components(separatedBy: "\r\n").first(where: { $0.lowercased().hasPrefix("origin:") }) else { return true }
    let origin = line.dropFirst(7).trimmingCharacters(in: .whitespaces)
    return origin.hasPrefix("http://localhost") || origin.hasPrefix("http://127.0.0.1")
}

let parameters = NWParameters.tcp
parameters.requiredLocalEndpoint = NWEndpoint.hostPort(host: "127.0.0.1", port: NWEndpoint.Port(rawValue: PORT)!)
parameters.allowLocalEndpointReuse = true
let listener = try NWListener(using: parameters)
listener.newConnectionHandler = { connection in
    connection.stateUpdateHandler = { state in
        switch state {
        case .failed, .cancelled: clients.removeAll { $0 === connection }
        default: break
        }
    }
    connection.start(queue: .main)
    connection.receive(minimumIncompleteLength: 1, maximumLength: 8192) { data, _, _, _ in
        let request = String(data: data ?? Data(), encoding: .utf8) ?? ""
        guard isLocal(request) else {
            connection.send(content: "HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n".data(using: .utf8), completion: .contentProcessed { _ in connection.cancel() })
            return
        }
        let origin = request.components(separatedBy: "\r\n").first { $0.lowercased().hasPrefix("origin:") }?.dropFirst(7).trimmingCharacters(in: .whitespaces) ?? "http://localhost:3000"
        let head = "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nCache-Control: no-cache\r\nConnection: keep-alive\r\nAccess-Control-Allow-Origin: \(origin)\r\n\r\n"
        connection.send(content: head.data(using: .utf8), completion: .contentProcessed { _ in clients.append(connection) })
    }
}
listener.stateUpdateHandler = { state in
    if case .failed(let error) = state {
        say("cannot listen on port \(PORT): \(error). Another copy is probably running.")
        exit(1)
    }
}
listener.start(queue: .main)
say("streaming on http://127.0.0.1:\(PORT)/motion")

// 60 times a second: the average of everything the sensor reported since the last tick (about 16 reports).
var ticks = 0
Timer.scheduledTimer(withTimeInterval: 1.0 / 60.0, repeats: true) { _ in
    ticks += 1
    if ticks == 120 { say(reports == 0 ? "no sensor reports after 2 s: try sudo native/motion, or this machine does not stream them" : "sensor is reporting (\(reports / 2) reports/s)") }
    if accel.n > 0 { lastAccel = [accel.x / accel.n, accel.y / accel.n, accel.z / accel.n] } else if reports == 0 { return }
    let w = gyro.n > 0 ? [gyro.x / gyro.n, gyro.y / gyro.n, gyro.z / gyro.n] : [0, 0, 0]
    accel = (0, 0, 0, 0)
    gyro = (0, 0, 0, 0)
    let f = { (v: [Double]) in "[" + v.map { String(format: "%.4f", $0) }.joined(separator: ",") + "]" }
    let line = "data: {\"a\":\(f(lastAccel)),\"w\":\(f(w)),\"lid\":\(lid.map(String.init) ?? "null")}\n\n".data(using: .utf8)
    for client in clients { client.send(content: line, completion: .idempotent) }
}
RunLoop.main.run()
