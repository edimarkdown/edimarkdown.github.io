use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};

#[cfg(desktop)]
use tauri::{Emitter, Manager};

#[derive(Default)]
struct PendingOpenPaths {
    paths: Mutex<Vec<String>>,
    frontend_ready: AtomicBool,
}

fn markdown_path(raw: &str, cwd: &Path) -> Option<PathBuf> {
    let candidate = Path::new(raw);
    let absolute = if candidate.is_absolute() {
        candidate.to_path_buf()
    } else {
        cwd.join(candidate)
    };
    let extension = absolute.extension()?.to_string_lossy().to_ascii_lowercase();
    if !matches!(extension.as_str(), "md" | "markdown") || !absolute.is_file() {
        return None;
    }
    Some(absolute.canonicalize().unwrap_or(absolute))
}

/// La ruta que se entrega a la ventana. En Windows, `canonicalize` devuelve la
/// forma extendida (`\\?\C:\Users\…`): vale para leer el disco, pero el
/// nombre del documento salía vacío —la interfaz cortaba en el `?` como si
/// fuera una dirección web— y el mismo archivo abierto con doble clic y
/// soltado parecía otro. Se devuelve la forma de siempre, salvo cuando la
/// extendida hace falta de verdad: rutas de 260 caracteres o más.
fn path_for_frontend(path: &Path) -> String {
    const MAX_PATH: usize = 260;
    let text = path.to_string_lossy();
    let plain = if let Some(rest) = text.strip_prefix(r"\\?\UNC\") {
        Some(format!(r"\\{rest}"))
    } else if let Some(rest) = text.strip_prefix(r"\\?\") {
        let bytes = rest.as_bytes();
        let is_drive = bytes.len() >= 3
            && bytes[0].is_ascii_alphabetic()
            && bytes[1] == b':'
            && bytes[2] == b'\\';
        is_drive.then(|| rest.to_string())
    } else {
        None
    };
    match plain {
        Some(plain) if plain.len() < MAX_PATH => plain,
        _ => text.into_owned(),
    }
}

fn markdown_paths<I>(args: I, cwd: &Path) -> Vec<String>
where
    I: IntoIterator<Item = String>,
{
    args.into_iter()
        .filter_map(|arg| markdown_path(&arg, cwd))
        .map(|path| path_for_frontend(&path))
        .collect()
}

#[tauri::command]
fn initial_markdown_paths(state: tauri::State<'_, PendingOpenPaths>) -> Vec<String> {
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let mut paths = markdown_paths(std::env::args().skip(1), &cwd);
    if let Ok(mut pending) = state.paths.lock() {
        paths.extend(pending.drain(..));
    }
    paths.sort();
    paths.dedup();
    state.frontend_ready.store(true, Ordering::Release);
    paths
}

/// Extensiones que la aplicación sabe abrir al soltarlas: el Markdown se abre
/// tal cual y el resto pasa por Pandoc, igual que en el navegador.
const DROPPABLE_EXTENSIONS: [&str; 9] = [
    "md", "markdown", "pdf", "docx", "odt", "epub", "html", "htm", "tex",
];

fn droppable_extension(path: &Path) -> Option<String> {
    let extension = path.extension()?.to_string_lossy().to_ascii_lowercase();
    DROPPABLE_EXTENSIONS
        .contains(&extension.as_str())
        .then_some(extension)
}

/// Recorre una carpeta soltada y recoge lo que se puede abrir. La profundidad
/// se limita para que soltar `/` por descuido no deje la aplicación recorriendo
/// el disco entero, y el número de archivos también: abrir mil pestañas no es
/// lo que nadie quiere de un arrastre.
fn collect_droppable(path: &Path, depth: usize, found: &mut Vec<PathBuf>) {
    const MAX_DEPTH: usize = 8;
    const MAX_FILES: usize = 200;

    if found.len() >= MAX_FILES {
        return;
    }
    if path.is_file() {
        if droppable_extension(path).is_some() {
            found.push(path.to_path_buf());
        }
        return;
    }
    if !path.is_dir() || depth > MAX_DEPTH {
        return;
    }
    let Ok(entries) = std::fs::read_dir(path) else {
        return;
    };
    // En orden: dos carpetas iguales tienen que abrir sus pestañas igual.
    let mut children: Vec<PathBuf> = entries
        .filter_map(|entry| entry.ok().map(|e| e.path()))
        .collect();
    children.sort();
    for child in children {
        collect_droppable(&child, depth + 1, found);
    }
}

/// Las rutas soltadas sobre la ventana, ya expandidas y filtradas.
#[tauri::command]
fn dropped_document_paths(paths: Vec<String>) -> Vec<String> {
    let mut found: Vec<PathBuf> = Vec::new();
    for raw in paths {
        let candidate = Path::new(&raw).to_path_buf();
        if !candidate.is_absolute() {
            continue;
        }
        collect_droppable(&candidate, 0, &mut found);
    }
    found.dedup();
    found
        .into_iter()
        .map(|path| path.to_string_lossy().into_owned())
        .collect()
}

/// El contenido en bruto de un documento soltado, para que Pandoc lo convierta
/// en el mismo camino que sigue el navegador con un `File`.
#[tauri::command]
fn read_dropped_document(path: String) -> Result<tauri::ipc::Response, String> {
    // 256 MB: un EPUB con imágenes cabe de sobra y nada razonable pasa de ahí.
    const MAX_BYTES: u64 = 256 * 1024 * 1024;

    let candidate = Path::new(&path);
    if !candidate.is_absolute() {
        return Err("La ruta del documento debe ser absoluta.".to_string());
    }
    if droppable_extension(candidate).is_none() {
        return Err("Ese tipo de archivo no se puede abrir.".to_string());
    }
    let metadata = std::fs::metadata(candidate).map_err(|error| error.to_string())?;
    if !metadata.is_file() {
        return Err("La ruta no corresponde a un archivo.".to_string());
    }
    if metadata.len() > MAX_BYTES {
        return Err("El documento es demasiado grande.".to_string());
    }
    std::fs::read(candidate)
        .map(tauri::ipc::Response::new)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn read_markdown_document(path: String) -> Result<String, String> {
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let safe_path = markdown_path(&path, &cwd)
        .ok_or_else(|| "La ruta no corresponde a un documento Markdown válido.".to_string())?;
    std::fs::read_to_string(safe_path).map_err(|error| error.to_string())
}

/// Ruta donde puede escribirse un documento. A diferencia de `markdown_path`,
/// no exige que el archivo exista todavía: sirve para volver a guardar uno que
/// se ha movido o borrado por fuera, y solo comprueba que la carpeta siga ahí.
fn markdown_target_path(raw: &str) -> Result<PathBuf, String> {
    let candidate = Path::new(raw);
    if !candidate.is_absolute() {
        return Err("La ruta del documento debe ser absoluta.".to_string());
    }
    let extension = candidate
        .extension()
        .map(|ext| ext.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    if !matches!(extension.as_str(), "md" | "markdown") {
        return Err("La ruta no corresponde a un documento Markdown válido.".to_string());
    }
    if candidate.is_dir() {
        return Err("La ruta del documento es una carpeta.".to_string());
    }
    let parent = candidate
        .parent()
        .ok_or_else(|| "El documento no tiene una carpeta válida.".to_string())?;
    if !parent.is_dir() {
        return Err("La carpeta del documento ya no existe.".to_string());
    }
    Ok(candidate.to_path_buf())
}

/// Guarda el documento en la ruta de la que salió.
///
/// El diálogo nativo autoriza al plugin de archivos a tocar lo que el usuario
/// elige, pero ese permiso dura lo que dura la sesión. Como la aplicación
/// recuerda los documentos abiertos de un arranque a otro, al volver ya no
/// podría escribir en ellos y guardar acabaría pidiendo otra vez la ubicación,
/// como si fuesen documentos nuevos. Por eso se escribe desde aquí, igual que
/// `read_markdown_document` lee los que llegan por argumentos o arrastrados.
#[tauri::command]
fn write_markdown_document(path: String, contents: String) -> Result<(), String> {
    let target = markdown_target_path(&path)?;
    std::fs::write(target, contents).map_err(|error| error.to_string())
}

/// La página del documento, tal y como la declara su formato: los cuatro
/// márgenes en centímetros y el papel. Viaja desde el editor porque es allí
/// donde se resuelve lo que dice el documento y lo que ponen las opciones
/// generales.
#[derive(Debug, Default, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct PrintPage {
    margin_top: Option<f64>,
    margin_right: Option<f64>,
    margin_bottom: Option<f64>,
    margin_left: Option<f64>,
    /// `a4` o `letter`, los dos que entiende el editor.
    paper_size: Option<String>,
    /// `portrait` o `landscape`.
    orientation: Option<String>,
}

/// Manda la vista previa a la impresora, que es de donde sale el PDF.
///
/// En el escritorio no basta con `window.print()` de la página: en macOS el
/// webview no lo implementa y la orden se pierde. Desde aquí se llama al motor
/// del propio webview, que abre el diálogo del sistema en los tres sistemas.
#[tauri::command]
fn print_document(window: tauri::WebviewWindow, page: Option<PrintPage>) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    if let Some(page) = page {
        if print_with_page_setup(&window, page) {
            return Ok(());
        }
    }
    #[cfg(not(target_os = "linux"))]
    let _ = page;
    window.print().map_err(|error| error.to_string())
}

/*
  En Linux el motor es WebKitGTK, y ese no hace caso a los márgenes de `@page`:
  imprime con los del cuadro del sistema, que son los suyos de fábrica y que el
  cuadro ni siquiera deja cambiar. Un documento con márgenes de 4 cm salía con
  0,63 por los cuatro lados.

  Así que los márgenes se le dan al cuadro, que es quien manda: se abre la
  impresión desde aquí con un `PageSetup` que lleva los del documento y su
  papel. Valen para todas las páginas —cosa que el relleno del texto no puede
  hacer, porque solo separa al principio del bloque— y no hay que adivinar
  cuánto pone cada sistema.

  Si algo de esto no sale, se devuelve `false` y la impresión sigue por el
  camino de siempre: más vale un documento con los márgenes del sistema que
  ninguno.
*/
#[cfg(target_os = "linux")]
fn print_with_page_setup(window: &tauri::WebviewWindow, page: PrintPage) -> bool {
    use std::sync::{Arc, Mutex};
    use webkit2gtk::{PrintOperation, PrintOperationExt};

    let lanzada = Arc::new(Mutex::new(false));
    let aviso = Arc::clone(&lanzada);
    let resultado = window.with_webview(move |webview| {
        let setup = gtk::PageSetup::new();
        let landscape = page.orientation.as_deref() == Some("landscape");
        if let Some(paper) = print_paper_size(page.paper_size.as_deref(), landscape) {
            setup.set_paper_size(&paper);
        }
        let unidad = gtk::Unit::Mm;
        // Del centímetro del documento al milímetro que entiende GTK.
        if let Some(cm) = page.margin_top {
            setup.set_top_margin(cm * 10.0, unidad);
        }
        if let Some(cm) = page.margin_right {
            setup.set_right_margin(cm * 10.0, unidad);
        }
        if let Some(cm) = page.margin_bottom {
            setup.set_bottom_margin(cm * 10.0, unidad);
        }
        if let Some(cm) = page.margin_left {
            setup.set_left_margin(cm * 10.0, unidad);
        }
        let operacion = PrintOperation::new(&webview.inner());
        operacion.set_page_setup(&setup);
        // Sin ventana madre: la de la aplicación no es una `gtk::Window` a
        // mano desde aquí, y el cuadro se abre igual.
        operacion.run_dialog(None::<&gtk::Window>);
        if let Ok(mut marca) = aviso.lock() {
            *marca = true;
        }
    });
    if resultado.is_err() {
        return false;
    }
    // `with_webview` corre en el hilo de la interfaz y devuelve al terminar,
    // así que a estas alturas la marca ya dice si el cuadro llegó a abrirse.
    lanzada.lock().map(|marca| *marca).unwrap_or(false)
}

/*
  WebKitGTK 2.46 introdujo una regresión que deja vacía la impresión cuando
  `GtkPageSetup` lleva la orientación `Landscape` (WebKit #286614), y sigue
  presente al menos en 2.50. Para no depender de la versión que traiga cada
  distribución, el mismo papel apaisado se expresa con sus medidas intercambiadas
  y la orientación neutra de GTK. El PDF y la impresora reciben exactamente A4
  o Carta horizontal, pero WebKit no entra en la ruta que genera páginas vacías.

  En vertical se conserva el papel estándar de GTK. Así el rodeo solo afecta
  al caso defectuoso y sirve también en versiones antiguas y futuras de WebKit.
*/
#[cfg(target_os = "linux")]
fn print_paper_size(paper: Option<&str>, landscape: bool) -> Option<gtk::PaperSize> {
    let (name, display_name, width_mm, height_mm) = paper_size_spec(paper)?;
    if !landscape {
        return Some(gtk::PaperSize::new(Some(name)));
    }
    Some(gtk::PaperSize::new_custom(
        &format!("edimark_{name}_landscape"),
        display_name,
        height_mm,
        width_mm,
        gtk::Unit::Mm,
    ))
}

/// Los nombres PWG que usa GTK para los dos papeles del editor.
#[cfg(target_os = "linux")]
fn paper_size_spec(paper: Option<&str>) -> Option<(&'static str, &'static str, f64, f64)> {
    match paper {
        Some("a4") => Some(("iso_a4", "A4", 210.0, 297.0)),
        Some("letter") => Some(("na_letter", "Letter", 215.9, 279.4)),
        _ => None,
    }
}

#[cfg(all(test, target_os = "linux"))]
mod print_tests {
    use super::paper_size_spec;

    #[test]
    fn knows_the_dimensions_of_supported_print_papers() {
        assert_eq!(
            paper_size_spec(Some("a4")),
            Some(("iso_a4", "A4", 210.0, 297.0))
        );
        assert_eq!(
            paper_size_spec(Some("letter")),
            Some(("na_letter", "Letter", 215.9, 279.4))
        );
        assert_eq!(paper_size_spec(Some("legal")), None);
    }
}

const IMAGE_EXTENSIONS: [&str; 9] = [
    "png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif", "ico",
];

/// Un `.md` corriente no lleva las imágenes dentro, sino que las referencia con
/// rutas relativas a su carpeta. La vista previa las pide por aquí, ya
/// resueltas contra la ruta del documento abierto.
///
/// Solo se sirven imágenes: la interfaz no debe poder leer un archivo
/// cualquiera del disco por el hecho de nombrarlo en un `![](…)`.
#[tauri::command]
fn read_document_asset(path: String) -> Result<tauri::ipc::Response, String> {
    // En binario, como el instalador: una imagen serializada a JSON multiplica
    // su tamaño y bloquea el webview mientras se descodifica.
    document_asset_bytes(&path).map(tauri::ipc::Response::new)
}

fn document_asset_bytes(path: &str) -> Result<Vec<u8>, String> {
    // 64 MB: una foto de móvil cabe de sobra y un vídeo o un disco de máquina
    // virtual, que no pintan nada en una vista previa, no se cargan en memoria.
    const MAX_BYTES: u64 = 64 * 1024 * 1024;

    let candidate = Path::new(path);
    if !candidate.is_absolute() {
        return Err("La ruta de la imagen debe ser absoluta.".to_string());
    }
    let extension = candidate
        .extension()
        .map(|ext| ext.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    if !IMAGE_EXTENSIONS.contains(&extension.as_str()) {
        return Err("Solo se pueden abrir imágenes.".to_string());
    }
    let metadata = std::fs::metadata(candidate).map_err(|error| error.to_string())?;
    if !metadata.is_file() {
        return Err("La ruta no corresponde a un archivo.".to_string());
    }
    if metadata.len() > MAX_BYTES {
        return Err("La imagen es demasiado grande para la vista previa.".to_string());
    }

    std::fs::read(candidate).map_err(|error| error.to_string())
}

const DOCUMENT_RESOURCE_EXTENSIONS: [&str; 3] = ["bib", "json", "csl"];

fn document_resource_path(document_path: &str, relative_path: &str) -> Result<PathBuf, String> {
    use std::path::Component;

    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let document = markdown_path(document_path, &cwd)
        .ok_or_else(|| "La ruta no corresponde a un documento Markdown válido.".to_string())?;
    let document_directory = document
        .parent()
        .ok_or_else(|| "El documento no tiene una carpeta válida.".to_string())?;
    let relative = Path::new(relative_path);
    if relative.is_absolute()
        || relative
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err("El recurso debe quedar dentro de la carpeta del documento.".to_string());
    }
    let extension = relative
        .extension()
        .map(|ext| ext.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    if !DOCUMENT_RESOURCE_EXTENSIONS.contains(&extension.as_str()) {
        return Err("Solo se admiten recursos bibliográficos o CSL.".to_string());
    }
    Ok(document_directory.join(relative))
}

fn document_resource_text(document_path: &str, relative_path: &str) -> Result<String, String> {
    const MAX_BYTES: u64 = 2 * 1024 * 1024;
    let document = markdown_path(
        document_path,
        &std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")),
    )
    .ok_or_else(|| "La ruta no corresponde a un documento Markdown válido.".to_string())?;
    let root = document
        .parent()
        .ok_or_else(|| "El documento no tiene una carpeta válida.".to_string())?;
    let candidate = document_resource_path(document_path, relative_path)?;
    let canonical = candidate
        .canonicalize()
        .map_err(|error| error.to_string())?;
    if !canonical.starts_with(root) {
        return Err("El recurso sale de la carpeta del documento.".to_string());
    }
    let metadata = std::fs::metadata(&canonical).map_err(|error| error.to_string())?;
    if !metadata.is_file() || metadata.len() > MAX_BYTES {
        return Err("El recurso no es un archivo válido o es demasiado grande.".to_string());
    }
    std::fs::read_to_string(canonical).map_err(|error| error.to_string())
}

#[tauri::command]
fn read_document_resource(document_path: String, relative_path: String) -> Result<String, String> {
    document_resource_text(&document_path, &relative_path)
}

fn decode_ipc_header(value: &str) -> Result<String, String> {
    fn hex_value(byte: u8) -> Option<u8> {
        match byte {
            b'0'..=b'9' => Some(byte - b'0'),
            b'a'..=b'f' => Some(byte - b'a' + 10),
            b'A'..=b'F' => Some(byte - b'A' + 10),
            _ => None,
        }
    }

    let input = value.as_bytes();
    let mut decoded = Vec::with_capacity(input.len());
    let mut index = 0;
    while index < input.len() {
        if input[index] == b'%' {
            if index + 2 >= input.len() {
                return Err("La ruta codificada no es válida.".to_string());
            }
            let high = hex_value(input[index + 1])
                .ok_or_else(|| "La ruta codificada no es válida.".to_string())?;
            let low = hex_value(input[index + 2])
                .ok_or_else(|| "La ruta codificada no es válida.".to_string())?;
            decoded.push((high << 4) | low);
            index += 3;
        } else {
            decoded.push(input[index]);
            index += 1;
        }
    }
    String::from_utf8(decoded).map_err(|_| "La ruta no está codificada en UTF-8.".to_string())
}

fn write_document_asset_bytes(
    document_path: &str,
    relative_path: &str,
    bytes: &[u8],
) -> Result<(), String> {
    use std::path::Component;

    const MAX_BYTES: usize = 64 * 1024 * 1024;
    if bytes.len() > MAX_BYTES {
        return Err("La imagen es demasiado grande para guardarla.".to_string());
    }

    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let document = markdown_path(document_path, &cwd)
        .ok_or_else(|| "La ruta no corresponde a un documento Markdown válido.".to_string())?;
    let relative = Path::new(relative_path);
    if relative.is_absolute()
        || relative
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(
            "La ruta de la imagen debe quedar dentro de la carpeta del documento.".to_string(),
        );
    }
    let extension = relative
        .extension()
        .map(|ext| ext.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    if !IMAGE_EXTENSIONS.contains(&extension.as_str()) {
        return Err("Solo se pueden guardar imágenes junto al documento.".to_string());
    }

    let document_directory = document
        .parent()
        .ok_or_else(|| "El documento no tiene una carpeta válida.".to_string())?;
    let mut safe_parent = document_directory.to_path_buf();
    if let Some(relative_parent) = relative.parent() {
        for component in relative_parent.components() {
            let Component::Normal(name) = component else {
                return Err("La carpeta de la imagen no es válida.".to_string());
            };
            let candidate = safe_parent.join(name);
            if candidate.exists() {
                let canonical = candidate
                    .canonicalize()
                    .map_err(|error| error.to_string())?;
                if !canonical.starts_with(document_directory) || !canonical.is_dir() {
                    return Err(
                        "La carpeta de la imagen sale de la carpeta del documento.".to_string()
                    );
                }
                safe_parent = canonical;
            } else {
                std::fs::create_dir(&candidate).map_err(|error| error.to_string())?;
                safe_parent = candidate;
            }
        }
    }
    let file_name = relative
        .file_name()
        .ok_or_else(|| "La imagen no tiene un nombre válido.".to_string())?;
    let destination = safe_parent.join(file_name);
    if destination.exists() {
        let current_destination = destination
            .canonicalize()
            .map_err(|error| error.to_string())?;
        if !current_destination.starts_with(document_directory) {
            return Err("La imagen existente sale de la carpeta del documento.".to_string());
        }
    }
    std::fs::write(destination, bytes).map_err(|error| error.to_string())
}

fn write_document_resource_bytes(
    document_path: &str,
    relative_path: &str,
    bytes: &[u8],
) -> Result<(), String> {
    use std::path::Component;

    const MAX_BYTES: usize = 2 * 1024 * 1024;
    if bytes.len() > MAX_BYTES {
        return Err("El recurso es demasiado grande para guardarlo.".to_string());
    }
    let destination = document_resource_path(document_path, relative_path)?;
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let document = markdown_path(document_path, &cwd)
        .ok_or_else(|| "La ruta no corresponde a un documento Markdown válido.".to_string())?;
    let document_directory = document
        .parent()
        .ok_or_else(|| "El documento no tiene una carpeta válida.".to_string())?;
    let relative = Path::new(relative_path);
    let mut safe_parent = document_directory.to_path_buf();
    if let Some(relative_parent) = relative.parent() {
        for component in relative_parent.components() {
            let Component::Normal(name) = component else {
                return Err("La carpeta del recurso no es válida.".to_string());
            };
            let candidate = safe_parent.join(name);
            if candidate.exists() {
                let canonical = candidate
                    .canonicalize()
                    .map_err(|error| error.to_string())?;
                if !canonical.starts_with(document_directory) || !canonical.is_dir() {
                    return Err(
                        "La carpeta del recurso sale de la carpeta del documento.".to_string()
                    );
                }
                safe_parent = canonical;
            } else {
                std::fs::create_dir(&candidate).map_err(|error| error.to_string())?;
                safe_parent = candidate;
            }
        }
    }
    let file_name = destination
        .file_name()
        .ok_or_else(|| "El recurso no tiene un nombre válido.".to_string())?;
    let safe_destination = safe_parent.join(file_name);
    if safe_destination.exists() {
        let canonical = safe_destination
            .canonicalize()
            .map_err(|error| error.to_string())?;
        if !canonical.starts_with(document_directory) {
            return Err("El recurso existente sale de la carpeta del documento.".to_string());
        }
    }
    std::fs::write(safe_destination, bytes).map_err(|error| error.to_string())
}

/// Copia una imagen recuperada junto al `.md` recién guardado. La ruta del
/// documento y la relativa viajan codificadas en cabeceras ASCII; los bytes
/// ocupan el cuerpo binario para no multiplicar su tamaño al serializarlos.
#[tauri::command]
fn write_document_asset(request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let document_path = request
        .headers()
        .get("x-document-path")
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| "Falta la ruta del documento.".to_string())
        .and_then(decode_ipc_header)?;
    let relative_path = request
        .headers()
        .get("x-relative-path")
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| "Falta la ruta de la imagen.".to_string())
        .and_then(decode_ipc_header)?;
    let bytes = match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => bytes,
        _ => return Err("La imagen debe enviarse en binario.".to_string()),
    };
    write_document_asset_bytes(&document_path, &relative_path, bytes)
}

#[tauri::command]
fn write_document_resource(request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let document_path = request
        .headers()
        .get("x-document-path")
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| "Falta la ruta del documento.".to_string())
        .and_then(decode_ipc_header)?;
    let relative_path = request
        .headers()
        .get("x-relative-path")
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| "Falta la ruta del recurso.".to_string())
        .and_then(decode_ipc_header)?;
    let bytes = match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => bytes,
        _ => return Err("El recurso debe enviarse en binario.".to_string()),
    };
    write_document_resource_bytes(&document_path, &relative_path, bytes)
}

/// Sistema y arquitectura del binario en marcha, para elegir el instalador
/// adecuado entre los adjuntos de la publicación de GitHub.
#[tauri::command]
fn update_target() -> String {
    format!("{}/{}", std::env::consts::OS, std::env::consts::ARCH)
}

const INSTALLER_EXTENSIONS: [&str; 5] = ["deb", "appimage", "msi", "exe", "dmg"];

fn safe_installer_name(file_name: &str) -> Option<String> {
    // Solo el nombre: un adjunto malicioso no debe poder escribir fuera de la
    // carpeta de descargas mediante `../` ni rutas absolutas.
    let name = Path::new(file_name)
        .file_name()?
        .to_string_lossy()
        .into_owned();
    if name.is_empty() || name.starts_with('.') {
        return None;
    }
    if !name
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-' | '+' | '~'))
    {
        return None;
    }
    let extension = Path::new(&name)
        .extension()?
        .to_string_lossy()
        .to_ascii_lowercase();
    if !INSTALLER_EXTENSIONS.contains(&extension.as_str()) {
        return None;
    }
    Some(name)
}

/// Guarda el instalador ya descargado por la interfaz y lo entrega al sistema:
/// los paquetes se abren con el instalador nativo y las AppImage, que no se
/// instalan, se muestran en su carpeta para que el usuario sustituya la suya.
#[tauri::command]
fn install_downloaded_update(
    app: tauri::AppHandle,
    request: tauri::ipc::Request<'_>,
) -> Result<String, String> {
    use tauri::Manager;
    use tauri_plugin_opener::OpenerExt;

    // El instalador viaja como cuerpo binario del IPC: un paquete de decenas de
    // megabytes serializado a JSON tardaría minutos y multiplicaría la memoria.
    let file_name = request
        .headers()
        .get("x-installer-name")
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| "Falta el nombre del instalador.".to_string())?;
    let bytes = match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => bytes,
        _ => return Err("El instalador debe enviarse en binario.".to_string()),
    };

    let name = safe_installer_name(file_name)
        .ok_or_else(|| "El nombre del instalador no es válido.".to_string())?;
    let extension = Path::new(&name)
        .extension()
        .map(|ext| ext.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();

    let directory = app
        .path()
        .download_dir()
        .ok()
        .filter(|dir| dir.is_dir())
        .unwrap_or_else(std::env::temp_dir)
        .join("EdiMarkdown");
    std::fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let destination = directory.join(&name);
    std::fs::write(&destination, bytes).map_err(|error| error.to_string())?;

    #[cfg(unix)]
    if extension == "appimage" {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&destination, std::fs::Permissions::from_mode(0o755))
            .map_err(|error| error.to_string())?;
    }

    let opener = app.opener();
    let handed_over = if extension == "appimage" {
        opener.reveal_item_in_dir(&destination)
    } else {
        opener.open_path(destination.to_string_lossy().into_owned(), None::<&str>)
    };
    if let Err(error) = handed_over {
        // El archivo está guardado aunque el escritorio no sepa abrirlo: se
        // devuelve la ruta para que la interfaz pueda indicarla.
        let _ = opener.reveal_item_in_dir(&destination);
        eprintln!("No se pudo abrir el instalador descargado: {error}");
    }

    Ok(destination.to_string_lossy().into_owned())
}

/*
  WebKitGTK trae el corrector ortográfico apagado, así que en Linux hay que
  encenderlo a mano y decirle en qué idioma se escribe; usa los diccionarios
  hunspell del sistema (en Debian, paquetes como `hunspell-es`). En Windows y
  macOS el webview del sistema ya corrige por su cuenta.
*/
#[cfg(target_os = "linux")]
fn apply_spell_checking(window: &tauri::WebviewWindow, enabled: bool, candidates: Vec<String>) {
    let _ = window.with_webview(move |webview| {
        use webkit2gtk::{WebContextExt, WebViewExt};
        let Some(context) = webview.inner().context() else {
            return;
        };
        context.set_spell_checking_enabled(enabled);
        if !enabled {
            return;
        }
        // El contexto descarta los códigos sin diccionario instalado, de modo
        // que la lista efectiva dice cuál ha valido. Si no vale ninguno se
        // queda vacía y WebKitGTK recurre al idioma del sistema.
        for code in candidates {
            context.set_spell_checking_languages(&[code.as_str()]);
            if !context.spell_checking_languages().is_empty() {
                break;
            }
        }
    });
}

/*
  enchant pide el código con región: `es` no encuentra nada y `es_ES` sí. Como
  el documento solo declara el idioma (`es`, `pt-BR`), aquí se proponen las
  variantes habituales y el corrector se queda con la primera instalada.
*/
#[cfg(target_os = "linux")]
fn spell_checking_candidates(lang: &str) -> Vec<String> {
    const REGIONS: &[(&str, &[&str])] = &[
        ("ca", &["ES"]),
        ("cs", &["CZ"]),
        ("da", &["DK"]),
        ("el", &["GR"]),
        ("en", &["US", "GB"]),
        ("es", &["ES", "MX", "AR"]),
        ("eu", &["ES"]),
        ("gl", &["ES"]),
        ("nb", &["NO"]),
        ("nn", &["NO"]),
        ("pt", &["PT", "BR"]),
        ("sv", &["SE"]),
        ("uk", &["UA"]),
        ("zh", &["CN", "TW"]),
    ];

    let mut parts = lang
        .trim()
        .split(['-', '_'])
        .filter(|part| !part.is_empty());
    let Some(language) = parts.next().map(str::to_ascii_lowercase) else {
        return Vec::new();
    };
    if language.len() < 2 || !language.chars().all(|c| c.is_ascii_alphabetic()) {
        return Vec::new();
    }

    // Un idioma con región (`pt-BR`) ya es la primera opción tal cual.
    let mut candidates = Vec::new();
    if let Some(region) = parts.next() {
        if region.len() == 2 && region.chars().all(|c| c.is_ascii_alphabetic()) {
            candidates.push(format!("{language}_{}", region.to_ascii_uppercase()));
        }
    }
    let regions = REGIONS
        .iter()
        .find(|(code, _)| *code == language)
        .map(|(_, regions)| *regions)
        .unwrap_or(&[]);
    for region in regions {
        candidates.push(format!("{language}_{region}"));
    }
    // Para el resto de idiomas, `fi_FI` o `pl_PL` es la forma más común.
    candidates.push(format!("{language}_{}", language.to_ascii_uppercase()));
    candidates.push(language);
    candidates.dedup();
    candidates
}

/*
  La interfaz avisa del idioma efectivo del documento cada vez que cambia y de
  si el usuario quiere el corrector encendido.
*/
#[tauri::command]
fn set_spell_checking(
    #[allow(unused_variables)] app: tauri::AppHandle,
    #[allow(unused_variables)] enabled: bool,
    #[allow(unused_variables)] lang: String,
) {
    #[cfg(target_os = "linux")]
    if let Some(window) = app.get_webview_window("main") {
        apply_spell_checking(&window, enabled, spell_checking_candidates(&lang));
    }
}

/// Traer la ventana al frente cuando llega un documento de fuera. `set_focus`
/// basta en Windows y macOS, pero varios escritorios de Linux no dejan que una
/// ventana se ponga delante por su cuenta y se limitan a ignorarlo; ahí el
/// aviso de atención es lo que hace que la barra de tareas la marque en vez de
/// que el documento se abra sin que nadie se entere.
#[cfg(desktop)]
fn bring_main_window_to_front(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let _ = window.show();
    let _ = window.unminimize();
    if window.set_focus().is_err() || !window.is_focused().unwrap_or(false) {
        let _ = window.request_user_attention(Some(tauri::UserAttentionType::Informational));
    }
}

#[cfg(desktop)]
fn deliver_markdown_paths(app: &tauri::AppHandle, paths: Vec<String>) {
    if paths.is_empty() {
        return;
    }
    let state = app.state::<PendingOpenPaths>();
    if state.frontend_ready.load(Ordering::Acquire) {
        let _ = app.emit("open-markdown-files", paths);
    } else if let Ok(mut pending) = state.paths.lock() {
        pending.extend(paths);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    // Debe registrarse antes que el resto de plugins: si el usuario abre otro
    // Markdown con la aplicación ya en marcha, la ruta llega a la ventana
    // existente en vez de perderse en un segundo proceso.
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            let paths = markdown_paths(args.into_iter().skip(1), Path::new(&cwd));
            deliver_markdown_paths(app, paths);
            bring_main_window_to_front(app);
        }));
    }

    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        // La descarga del instalador la hace Rust: GitHub redirige los
        // adjuntos a un servidor sin cabeceras CORS y el webview los rechaza.
        .plugin(tauri_plugin_http::init())
        .manage(PendingOpenPaths::default())
        .invoke_handler(tauri::generate_handler![
            initial_markdown_paths,
            dropped_document_paths,
            read_dropped_document,
            read_markdown_document,
            write_markdown_document,
            print_document,
            read_document_asset,
            read_document_resource,
            write_document_asset,
            write_document_resource,
            update_target,
            install_downloaded_update,
            set_spell_checking
        ])
        .build(tauri::generate_context!())
        .expect("error al preparar EdiMarkdown")
        .run(
            |#[allow(unused_variables)] app, #[allow(unused_variables)] event| {
                // Finder entrega los documentos asociados mediante el evento
                // nativo Opened, no como argumentos de línea de órdenes.
                #[cfg(target_os = "macos")]
                if let tauri::RunEvent::Opened { urls } = event {
                    let paths = urls
                        .into_iter()
                        .filter_map(|url| url.to_file_path().ok())
                        .filter(|path| {
                            matches!(
                                path.extension()
                                    .map(|ext| ext.to_string_lossy().to_ascii_lowercase()),
                                Some(ext) if matches!(ext.as_str(), "md" | "markdown")
                            )
                        })
                        .map(|path| path.to_string_lossy().into_owned())
                        .collect();
                    deliver_markdown_paths(app, paths);
                    // Finder ya trae la aplicación al frente, pero si estaba
                    // minimizada el documento se abriría sin verse.
                    bring_main_window_to_front(app);
                }
            },
        );
}

#[cfg(test)]
mod tests {
    use super::{
        decode_ipc_header, document_asset_bytes, document_resource_text, droppable_extension,
        markdown_target_path, path_for_frontend, write_document_asset_bytes,
        write_document_resource_bytes,
    };

    #[test]
    fn la_ruta_extendida_de_windows_llega_a_la_ventana_en_su_forma_de_siempre() {
        use std::path::Path;
        assert_eq!(
            path_for_frontend(Path::new(r"\\?\C:\Users\Ana\Prova Enrique\informe.md")),
            r"C:\Users\Ana\Prova Enrique\informe.md"
        );
        assert_eq!(
            path_for_frontend(Path::new(r"\\?\UNC\servidor\carpeta\tema.md")),
            r"\\servidor\carpeta\tema.md"
        );
        assert_eq!(path_for_frontend(Path::new("/home/ana/tema.md")), "/home/ana/tema.md");
        // Sin la forma extendida, Windows no abriría una ruta tan larga.
        let larga = format!(r"\\?\C:\{}\tema.md", "a".repeat(300));
        assert_eq!(path_for_frontend(Path::new(&larga)), larga);
        // Un volumen sin letra solo tiene la forma extendida.
        let volumen = r"\\?\Volume{12345678-1234-1234-1234-123456789abc}\tema.md";
        assert_eq!(path_for_frontend(Path::new(volumen)), volumen);
    }

    /// Carpeta de trabajo con un documento y su imagen al lado, como la de
    /// cualquier artículo.
    fn carpeta_con_imagen(nombre: &str) -> std::path::PathBuf {
        let raiz = std::env::temp_dir().join(format!("edimark-test-{nombre}"));
        let imagenes = raiz.join("imagenes");
        std::fs::create_dir_all(&imagenes).expect("no se pudo crear la carpeta de prueba");
        std::fs::write(imagenes.join("01.png"), [137, 80, 78, 71]).expect("no se pudo escribir");
        std::fs::write(raiz.join("apuntes.md"), "# Apuntes").expect("no se pudo escribir");
        raiz
    }

    /// El arrastre nativo tiene su propia lista de extensiones, y se quedó sin
    /// `pdf` cuando se añadió la importación de PDF: en el escritorio soltar un
    /// PDF decía que no era un tipo permitido mientras en la web se abría.
    #[test]
    fn se_pueden_soltar_todos_los_formatos_que_se_importan() {
        for nombre in [
            "apuntes.md", "apuntes.markdown", "informe.pdf", "informe.docx",
            "informe.odt", "libro.epub", "pagina.html", "pagina.htm", "articulo.tex",
        ] {
            assert!(
                droppable_extension(std::path::Path::new(nombre)).is_some(),
                "debería poder soltarse: {nombre}"
            );
        }
        // Y lo que la aplicación no sabe abrir sigue fuera.
        for nombre in ["imagen.png", "hoja.xlsx", "programa.exe", "sin-extension"] {
            assert!(
                droppable_extension(std::path::Path::new(nombre)).is_none(),
                "no debería poder soltarse: {nombre}"
            );
        }
    }

    #[test]
    fn sirve_la_imagen_que_acompana_al_documento() {
        let raiz = carpeta_con_imagen("imagen");
        let ruta = raiz.join("imagenes").join("01.png");
        let bytes = document_asset_bytes(&ruta.to_string_lossy()).expect("debería leerse");
        assert_eq!(bytes, vec![137, 80, 78, 71]);
        let _ = std::fs::remove_dir_all(raiz);
    }

    #[test]
    fn no_sirve_archivos_que_no_son_imagenes() {
        let raiz = carpeta_con_imagen("markdown");
        let ruta = raiz.join("apuntes.md");
        // Un `![](apuntes.md)` no debe convertirse en una forma de leer
        // cualquier archivo del disco desde la interfaz.
        assert!(document_asset_bytes(&ruta.to_string_lossy()).is_err());
        let _ = std::fs::remove_dir_all(raiz);
    }

    #[test]
    fn exige_rutas_absolutas_y_archivos_existentes() {
        assert!(document_asset_bytes("imagenes/01.png").is_err());
        assert!(document_asset_bytes("/no/existe/01.png").is_err());
    }

    #[test]
    fn guarda_una_imagen_dentro_de_la_carpeta_del_documento() {
        let raiz = carpeta_con_imagen("guardar-imagen");
        let documento = raiz.join("apuntes.md");
        write_document_asset_bytes(
            &documento.to_string_lossy(),
            "nuevas/gráfico.png",
            &[1, 2, 3, 4],
        )
        .expect("debería guardar la imagen");
        assert_eq!(
            std::fs::read(raiz.join("nuevas").join("gráfico.png")).expect("falta la imagen"),
            vec![1, 2, 3, 4]
        );
        let _ = std::fs::remove_dir_all(raiz);
    }

    #[test]
    fn no_guarda_fuera_del_documento_ni_permite_otras_extensiones() {
        let raiz = carpeta_con_imagen("guardar-segura");
        let documento = raiz.join("apuntes.md");
        assert!(
            write_document_asset_bytes(&documento.to_string_lossy(), "../fuera.png", &[1]).is_err()
        );
        assert!(
            write_document_asset_bytes(&documento.to_string_lossy(), "datos.txt", &[1]).is_err()
        );
        let _ = std::fs::remove_dir_all(raiz);
    }

    #[test]
    fn lee_y_guarda_la_bibliografia_portable_del_documento() {
        let raiz = carpeta_con_imagen("bibliografia-portable");
        let documento = raiz.join("apuntes.md");
        let bib = b"@book{mayer2009, title={Multimedia Learning}}";
        write_document_resource_bytes(&documento.to_string_lossy(), "apuntes/references.bib", bib)
            .expect("debería guardar la bibliografía");
        assert_eq!(
            document_resource_text(&documento.to_string_lossy(), "apuntes/references.bib",)
                .expect("debería leer la bibliografía"),
            String::from_utf8_lossy(bib),
        );
        assert!(document_resource_text(&documento.to_string_lossy(), "../fuera.bib").is_err());
        assert!(write_document_resource_bytes(
            &documento.to_string_lossy(),
            "apuntes/notas.txt",
            b"no",
        )
        .is_err());
        let _ = std::fs::remove_dir_all(raiz);
    }

    #[cfg(unix)]
    #[test]
    fn no_sigue_enlaces_simbolicos_fuera_de_la_carpeta_del_documento() {
        use std::os::unix::fs::symlink;

        let raiz = carpeta_con_imagen("guardar-enlace");
        let fuera = std::env::temp_dir().join("edimark-test-destino-externo");
        std::fs::create_dir_all(&fuera).expect("no se pudo crear el destino externo");
        symlink(&fuera, raiz.join("enlace")).expect("no se pudo crear el enlace");
        let documento = raiz.join("apuntes.md");
        assert!(
            write_document_asset_bytes(&documento.to_string_lossy(), "enlace/fuera.png", &[1])
                .is_err()
        );
        assert!(!fuera.join("fuera.png").exists());
        let _ = std::fs::remove_dir_all(raiz);
        let _ = std::fs::remove_dir_all(fuera);
    }

    #[test]
    fn admite_la_ruta_del_documento_abierto_aunque_ya_no_exista_el_archivo() {
        let raiz = carpeta_con_imagen("guardar-documento");
        let existente = raiz.join("apuntes.md");
        assert!(markdown_target_path(&existente.to_string_lossy()).is_ok());
        // Un documento borrado o movido por fuera se vuelve a escribir donde
        // estaba: lo que tiene que seguir ahí es la carpeta, no el archivo.
        let borrado = raiz.join("otro.markdown");
        assert!(markdown_target_path(&borrado.to_string_lossy()).is_ok());
        let _ = std::fs::remove_dir_all(raiz);
    }

    #[test]
    fn no_guarda_documentos_en_rutas_que_no_son_markdown() {
        let raiz = carpeta_con_imagen("guardar-documento-seguro");
        assert!(markdown_target_path("apuntes.md").is_err());
        assert!(markdown_target_path(&raiz.join("notas.txt").to_string_lossy()).is_err());
        let carpeta = raiz.join("carpeta.md");
        std::fs::create_dir_all(&carpeta).expect("no se pudo crear la carpeta");
        assert!(markdown_target_path(&carpeta.to_string_lossy()).is_err());
        assert!(markdown_target_path("/no/existe/apuntes.md").is_err());
        let _ = std::fs::remove_dir_all(raiz);
    }

    #[test]
    fn descodifica_las_rutas_unicode_de_las_cabeceras_ipc() {
        assert_eq!(
            decode_ipc_header("%2Forigen%2FApuntes%20de%20biolog%C3%ADa.md")
                .expect("debería descodificar"),
            "/origen/Apuntes de biología.md"
        );
        assert!(decode_ipc_header("%GG").is_err());
    }
}
