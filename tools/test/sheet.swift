import AppKit
let files = Array(CommandLine.arguments.dropFirst(2)); let out = CommandLine.arguments[1]
let cw = 600.0, ch = 390.0, cols = 3.0, rows = ceil(Double(files.count)/cols)
let img = NSImage(size: NSSize(width: cw*cols, height: ch*rows))
img.lockFocus()
NSColor.black.setFill(); NSRect(x:0,y:0,width:cw*cols,height:ch*rows).fill()
for (i,f) in files.enumerated() {
  guard let im = NSImage(contentsOfFile: f) else { continue }
  let c = Double(i % 3), r = Double(i / 3)
  let rect = NSRect(x: c*cw, y: (rows-1-r)*ch, width: cw-4, height: ch-4)
  im.draw(in: rect)
  let name = (f as NSString).lastPathComponent
  (name as NSString).draw(at: NSPoint(x: rect.minX+6, y: rect.minY+6), withAttributes: [.foregroundColor: NSColor.yellow, .font: NSFont.boldSystemFont(ofSize: 18), .backgroundColor: NSColor.black])
}
img.unlockFocus()
let rep = NSBitmapImageRep(data: img.tiffRepresentation!)!
try! rep.representation(using: .jpeg, properties: [.compressionFactor: 0.7])!.write(to: URL(fileURLWithPath: out))
