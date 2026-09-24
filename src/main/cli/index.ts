// SquashForge on the command line, and the MCP server for AI apps.
//
// Runs as plain Node inside the SquashForge executable (ELECTRON_RUN_AS_NODE=1),
// so no window opens. The squashforge / squashforge.cmd launcher sets that up.

// sharp warns that Electron's Linux build may not match its binaries;
// SquashForge ships the matching ones, so the note is just noise. This has to
// be in place before sharp loads, hence the dynamic import below.
const emit = process.emitWarning.bind(process)
process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
  const opts = rest[0] as { code?: string; type?: string } | string | undefined
  const tag = typeof opts === 'string' ? opts : (opts?.code ?? opts?.type)
  if (tag === 'SharpElectronLinux') return
  return (emit as (...a: unknown[]) => void)(warning, ...rest)
}) as typeof process.emitWarning

void import('./main').then((cli) => cli.run(process.argv.slice(2)))
