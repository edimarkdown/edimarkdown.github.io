import Cocoa
import WebKit

// Imprime EdiMarkdown a PDF con el motor de Safari (un WKWebView), como lo
// hace la aplicación de macOS: márgenes del sistema a cero, mandan los de @page.
// Se compila con `swiftc -O macos.swift -o macos` y se ejecuta en la carpeta
// donde está medir.js:
//   ./macos <url> <destino.pdf> <datos.json> <ancho pt> <alto pt> [previo.js]
// Ver LEEME.md.
let a = CommandLine.arguments
let direccion = URL(string: a[1])!
let pdf = URL(fileURLWithPath: a[2])
let datos = URL(fileURLWithPath: a[3])
let papel = NSSize(width: Double(a[4])!, height: Double(a[5])!)
let previo: String? = a.count > 6 ? (try? String(contentsOfFile: a[6], encoding: .utf8)) : nil
let conMarco = !(a.count > 7 && a[7] == "sinmarco")
let medir = try! String(contentsOfFile: "medir.js", encoding: .utf8)

final class Control: NSObject, WKNavigationDelegate {
    let ventana: NSWindow
    let vista: WKWebView
    var iguales = 0
    var ultimo = ""
    var vueltas = 0
    override init() {
        let marco = NSRect(x: 0, y: 0, width: 2700, height: 1100)
        ventana = NSWindow(contentRect: marco, styleMask: [.borderless], backing: .buffered, defer: false)
        vista = WKWebView(frame: marco)
        super.init()
        ventana.contentView = vista
        vista.navigationDelegate = self
        ventana.orderFront(nil)
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        if let previo = previo {
            vista.evaluateJavaScript(previo) { _, error in
                if let error = error { print("error en previo: \(error)") }
                self.luego(1.5)
            }
        } else {
            luego(1.5)
        }
    }
    func luego(_ segundos: Double) {
        DispatchQueue.main.asyncAfter(deadline: .now() + segundos) { self.sondea() }
    }
    func sondea() {
        vueltas += 1
        vista.evaluateJavaScript(medir) { resultado, error in
            if let texto = resultado as? String, let bytes = texto.data(using: .utf8),
               let objeto = (try? JSONSerialization.jsonObject(with: bytes)) as? [String: Any] {
                let paginas = (objeto["paginas"] as? NSNumber)?.intValue ?? 0
                let listo = (objeto["listo"] as? Bool) ?? false
                let clave = "\(paginas)-\(String(describing: objeto["alto"]))"
                if clave == self.ultimo && paginas > 1 && listo { self.iguales += 1 } else { self.iguales = 0 }
                self.ultimo = clave
                if self.iguales >= 4 {
                    try? texto.write(to: datos, atomically: true, encoding: .utf8)
                    self.imprime()
                    return
                }
            } else if let error = error {
                print("error JS: \(error)")
            }
            if self.vueltas > 90 { print("no se llegó a paginar: \(self.ultimo)"); exit(3) }
            self.luego(1.0)
        }
    }
    func imprime() {
        // Como la aplicación de macOS: márgenes del sistema a cero; mandan los de @page.
        let info = NSPrintInfo(dictionary: [
            .jobDisposition: NSPrintInfo.JobDisposition.save,
            .jobSavingURL: pdf,
        ])
        info.paperSize = papel
        info.topMargin = 0
        info.bottomMargin = 0
        info.leftMargin = 0
        info.rightMargin = 0
        let op = vista.printOperation(with: info)
        op.showsPrintPanel = false
        op.showsProgressPanel = false
        if conMarco { op.view?.frame = vista.bounds }
        op.runModal(for: ventana, delegate: self,
                    didRun: #selector(fin(_:success:contextInfo:)), contextInfo: nil)
    }
    @objc func fin(_ op: NSPrintOperation, success: Bool, contextInfo: UnsafeMutableRawPointer?) {
        print(success ? "impreso \(pdf.lastPathComponent)" : "fallo \(pdf.lastPathComponent)")
        exit(success ? 0 : 1)
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let control = Control()
control.vista.load(URLRequest(url: direccion))
DispatchQueue.main.asyncAfter(deadline: .now() + 170) { print("tiempo agotado"); exit(2) }
app.run()
