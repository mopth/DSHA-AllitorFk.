/*
 * AllitorFk assetstudio-mcp entry point (written for AllitorFk, MIT).
 *
 * Transports around the MIT McpServerCore from AssetStudio Mobile:
 *  - stdio (default): newline-delimited JSON-RPC, the transport DSH's MCP client uses.
 *  - loopback HTTP (opt-in): binds 127.0.0.1 only, requires a bearer token, rejects any
 *    browser Origin and foreign Host headers. This fixes the upstream all-interfaces,
 *    no-auth listener. There is no Android UI and no signing material in this build.
 */
package com.allitorfk.assetmcp

import com.assetstudio.mobile.core.manager.AssetsManager
import com.assetstudio.mobile.mcp.McpOutcome
import com.assetstudio.mobile.mcp.McpServerCore
import java.io.BufferedReader
import java.io.File
import java.io.InputStreamReader
import java.io.PrintStream
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.nio.file.LinkOption
import java.nio.file.attribute.PosixFilePermission
import java.security.MessageDigest
import java.security.SecureRandom

const val VERSION = "1.10.2-allitorfk.1"
private const val MAX_FILE_BYTES = 768L * 1024 * 1024
private const val MAX_BODY = 4 * 1024 * 1024
private const val MAX_FILES = 5000

private val ALLOWED_EXT = setOf("bundle", "unity3d", "assetbundle", "assets", "ress", "resource", "ab", "dat", "bytes")

fun usage(): String = """
assetstudio-mcp $VERSION  (Unity asset browser over MCP; AssetStudio MIT core)

usage: assetstudio-mcp [--load PATH]... [--export-dir DIR] [--stdio | --http PORT --token-file FILE]

  --load PATH        Unity file or folder to index (repeatable; folders scanned, max $MAX_FILES files)
  --export-dir DIR   where export_asset writes files (default: ./assetstudio-export)
  --stdio            serve MCP over stdin/stdout (default)
  --http PORT        serve MCP on http://127.0.0.1:PORT/mcp (loopback only)
  --token-file FILE  required with --http; a random token is written there (mode 0600) unless
                     the env ASSETSTUDIO_MCP_TOKEN is set. Clients send Authorization: Bearer <token>.
  --help, --version
Only process assets you have the right to inspect.
""".trimIndent()

class Options {
    val load = ArrayList<String>()
    var exportDir = "assetstudio-export"
    var httpPort = -1
    var tokenFile: String? = null
}

fun parseArgs(args: Array<String>, out: PrintStream): Options? {
    val o = Options()
    var i = 0
    fun next(name: String): String {
        if (i + 1 >= args.size) throw IllegalArgumentException("$name needs a value")
        return args[++i]
    }
    while (i < args.size) {
        when (val a = args[i]) {
            "--help", "-h" -> { out.println(usage()); return null }
            "--version" -> { out.println("assetstudio-mcp $VERSION"); return null }
            "--load" -> o.load.add(next(a))
            "--export-dir" -> o.exportDir = next(a)
            "--stdio" -> o.httpPort = -1
            "--http" -> o.httpPort = next(a).toIntOrNull()?.takeIf { it in 1024..65535 }
                ?: throw IllegalArgumentException("--http needs a port 1024-65535")
            "--token-file" -> o.tokenFile = next(a)
            else -> throw IllegalArgumentException("unknown option $a")
        }
        i++
    }
    if (o.httpPort > 0 && o.tokenFile == null) throw IllegalArgumentException("--http requires --token-file")
    return o
}

fun collectFiles(paths: List<String>): List<File> {
    val result = ArrayList<File>()
    for (p in paths) {
        val f = File(p)
        if (Files.isSymbolicLink(f.toPath())) continue
        if (f.isFile) result.add(f)
        else if (f.isDirectory) f.walkTopDown().onEnter { !Files.isSymbolicLink(it.toPath()) }
            .filter { it.isFile && !Files.isSymbolicLink(it.toPath()) &&
                (it.extension.lowercase() in ALLOWED_EXT || it.extension.isEmpty()) }
            .take(MAX_FILES).forEach { result.add(it) }
    }
    return result.sortedBy { it.length() }.take(MAX_FILES)
}

/** Two-stage heap guard in the spirit of ASM: stop reading at 60%, stop building at 78%. */
fun heapRatio(): Double {
    val rt = Runtime.getRuntime()
    return (rt.totalMemory() - rt.freeMemory()).toDouble() / rt.maxMemory()
}

fun loadAll(mgr: AssetsManager, files: List<File>, log: PrintStream): Int {
    var loaded = 0
    for (f in files) {
        if (f.length() > MAX_FILE_BYTES) { log.println("skip (too large): ${f.name}"); continue }
        if (heapRatio() > 0.60) { System.gc(); if (heapRatio() > 0.60) { log.println("memory guard: stop reading"); break } }
        try { mgr.loadFileDeferred(f.name, f.readBytes()); loaded++ }
        catch (t: Throwable) { log.println("skip ${f.name}: ${t.javaClass.simpleName}") }
    }
    val left = mgr.finishLoading { heapRatio() > 0.78 }
    if (left > 0) log.println("memory guard: $left files not built")
    return loaded
}

fun constantTimeEquals(a: String, b: String): Boolean =
    MessageDigest.isEqual(a.toByteArray(StandardCharsets.UTF_8), b.toByteArray(StandardCharsets.UTF_8))

fun prepareToken(file: String): String {
    val env = System.getenv("ASSETSTUDIO_MCP_TOKEN")
    if (env != null) {
        require(env.matches(Regex("[A-Za-z0-9_-]{24,128}"))) { "ASSETSTUDIO_MCP_TOKEN must be 24-128 url-safe chars" }
        return env
    }
    val bytes = ByteArray(32).also { SecureRandom().nextBytes(it) }
    val token = java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
    val path = File(file).toPath()
    if (Files.exists(path, LinkOption.NOFOLLOW_LINKS)) Files.delete(path)
    Files.createFile(path)
    try { Files.setPosixFilePermissions(path, setOf(PosixFilePermission.OWNER_READ, PosixFilePermission.OWNER_WRITE)) }
    catch (_: UnsupportedOperationException) {}
    Files.write(path, token.toByteArray(StandardCharsets.US_ASCII))
    return token
}

/** Pure request gate, unit-testable: returns null when allowed, else an HTTP status + reason. */
fun gate(method: String, path: String, headers: Map<String, String>, port: Int, token: String): Pair<Int, String>? {
    if (path != "/mcp") return 404 to "not found"
    if (method != "POST") return 405 to "POST only"
    // Browsers always send Origin on cross-site POST; a CLI MCP client does not. Refuse any Origin.
    if (headers.containsKey("origin")) return 403 to "browser origin refused"
    val host = headers["host"] ?: return 400 to "missing host"
    if (host != "127.0.0.1:$port" && host != "localhost:$port") return 403 to "foreign host refused"
    val auth = headers["authorization"] ?: return 401 to "missing token"
    if (!auth.startsWith("Bearer ") || !constantTimeEquals(auth.removePrefix("Bearer "), token)) return 401 to "bad token"
    if (!(headers["content-type"] ?: "").startsWith("application/json")) return 415 to "json only"
    return null
}

fun serveHttp(core: McpServerCore, port: Int, token: String, log: PrintStream) {
    ServerSocket(port, 16, InetAddress.getLoopbackAddress()).use { server ->
        log.println("assetstudio-mcp listening on http://127.0.0.1:$port/mcp (token required)")
        while (true) {
            val socket = server.accept()
            Thread { socket.use { handleHttp(core, it, port, token) } }.apply { isDaemon = true }.start()
        }
    }
}

private fun handleHttp(core: McpServerCore, socket: Socket, port: Int, token: String) {
    socket.soTimeout = 30_000
    val input = socket.getInputStream().buffered()
    fun readLine(): String? {
        val sb = StringBuilder()
        while (true) {
            val c = input.read()
            if (c < 0) return if (sb.isEmpty()) null else sb.toString()
            if (c == '\n'.code) return sb.toString().trimEnd('\r')
            sb.append(c.toChar())
            if (sb.length > 8192) return null
        }
    }
    val out = socket.getOutputStream()
    fun reply(code: Int, body: String, type: String = "application/json") {
        val bytes = body.toByteArray(StandardCharsets.UTF_8)
        out.write(("HTTP/1.1 $code X\r\ncontent-type: $type\r\ncontent-length: ${bytes.size}\r\n" +
            "cache-control: no-store\r\nconnection: close\r\n\r\n").toByteArray(StandardCharsets.US_ASCII))
        out.write(bytes); out.flush()
    }
    val start = readLine() ?: return
    val parts = start.split(" ")
    if (parts.size != 3) return reply(400, "{}")
    val headers = HashMap<String, String>()
    var count = 0
    while (true) {
        val line = readLine() ?: return
        if (line.isEmpty()) break
        if (++count > 64) return reply(431, "{}")
        val idx = line.indexOf(':')
        if (idx > 0) headers[line.substring(0, idx).trim().lowercase()] = line.substring(idx + 1).trim()
    }
    gate(parts[0], parts[1], headers, port, token)?.let { return reply(it.first, "{\"error\":\"${it.second}\"}") }
    val length = headers["content-length"]?.toIntOrNull() ?: return reply(411, "{}")
    if (length < 0 || length > MAX_BODY) return reply(413, "{}")
    val body = ByteArray(length)
    var read = 0
    while (read < length) { val n = input.read(body, read, length - read); if (n < 0) return; read += n }
    when (val outcome = core.handle(String(body, StandardCharsets.UTF_8))) {
        is McpOutcome.Reply -> reply(200, outcome.body)
        McpOutcome.Accepted -> reply(202, "")
    }
}

fun serveStdio(core: McpServerCore) {
    val reader = BufferedReader(InputStreamReader(System.`in`, StandardCharsets.UTF_8))
    val out = PrintStream(System.out, true, "UTF-8")
    while (true) {
        val line = reader.readLine() ?: return
        if (line.isBlank()) continue
        if (line.length > MAX_BODY) continue
        when (val outcome = core.handle(line)) {
            is McpOutcome.Reply -> out.println(outcome.body)
            McpOutcome.Accepted -> {}
        }
    }
}

fun main(args: Array<String>) {
    val log = System.err
    val opts = try { parseArgs(args, System.out) ?: return } catch (e: IllegalArgumentException) {
        log.println("assetstudio-mcp: ${e.message}\n\n${usage()}"); kotlin.system.exitProcess(2)
    }
    val mgr = AssetsManager()
    val files = collectFiles(opts.load)
    if (files.isNotEmpty()) log.println("loaded ${loadAll(mgr, files, log)} / ${files.size} files")
    val source = CliMcpSource(mgr, File(opts.exportDir))
    val core = McpServerCore("assetstudio-mcp", VERSION) { source }
    if (opts.httpPort > 0) serveHttp(core, opts.httpPort, prepareToken(opts.tokenFile!!), log)
    else serveStdio(core)
}
