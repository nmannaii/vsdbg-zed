# vsdbg-zed

A DAP stdio proxy that lets Zed debug .NET with Microsoft's **vsdbg** instead of netcoredbg.

## Why this exists

`vsdbg-ui` will not start a debuggee until the DAP client answers a **`handshake` reverse
request**: the adapter sends

```json
{"type":"request","command":"handshake","arguments":{"value":"<challenge>"}}
```

and the client must reply with a signature produced by VS Code's native `vsda.node` module.

nvim-dap can do this — it exposes `adapter.reverse_request_handlers`. Zed cannot: its debugger
extension API is only `get_dap_binary`, `dap_request_kind`, `dap_config_to_scenario`,
`dap_locator_create_scenario` and `run_dap_locator`. There is **no hook for reverse requests**, so
Zed never answers, and vsdbg stalls on launch.

This proxy moves the handler out of the editor:

```
Zed  <--DAP/stdio-->  vsdbg-zed  <--DAP/stdio-->  vsdbg-ui --interpreter=vscode
                          |
                          +-- "handshake"     -->  vsda.signer.sign()  -->  reply to vsdbg
                          +-- everything else -->  forwarded verbatim
```

The handshake never reaches Zed. Everything else — including `runInTerminal`, which Zed handles
natively — is passed through untouched.

Note: vsdbg only fires the handshake on `launch`, not on `initialize`.

## Install

Zero npm dependencies. Requires Node 18+ and a local VS Code install (for `vsda.node`) plus the
C# extension (for `vsdbg-ui`).

Add to `~/.config/zed/settings.json` — absolute path, Zed does not expand `~`:

```json
"dap": {
  "netcoredbg": {
    "binary": "/home/najmedine-mannaii/Documents/vsdbg-zed/bin/vsdbg-zed.js"
  }
}
```

This hijacks the `netcoredbg` adapter from the
[zed-netcoredbg](https://github.com/qwadrox/zed-netcoredbg) extension, which passes a user-provided
binary path straight through without validation. No Rust extension to build.

Do not set `args`: the extension hardcodes `--interpreter=vscode`, which the proxy ignores in
favour of its own child args.

## Per-project `.zed/debug.json`

One entry per debuggable project. `request` is required; the editor schema also wants a `program`
ending in `.dll`/`.exe` for `launch`.

```json
[
  {
    "label": "<Service>",
    "adapter": "netcoredbg",
    "request": "launch",
    "program": "${ZED_WORKTREE_ROOT}/<group>/<Service>/bin/Debug/net9.0/<Service>.dll",
    "cwd": "${ZED_WORKTREE_ROOT}/<group>/<Service>",
    "env": {
      "ASPNETCORE_ENVIRONMENT": "Development"
    },
    "build": {
      "command": "dotnet",
      "args": [
        "build",
        "${ZED_WORKTREE_ROOT}/<group>/<Service>/<Service>.csproj",
        "-p:Configuration=Debug",
        "-p:TargetFramework=net9.0"
      ]
    }
  }
]
```

Use braces — `${ZED_WORKTREE_ROOT}`. Zed substitutes variables before the extension is called, so
vsdbg only ever sees absolute paths.

### Which keys go where

`label`, `adapter`, `build` and `tcp_connection` are named fields of Zed's `debug-scenario`
(`dap.wit:74-101`); Zed consumes them and they never reach the adapter. Everything else — `request`
included — is collected into `config` and forwarded **verbatim** as the launch arguments
(`zed-netcoredbg/src/lib.rs:70,98`). The extension validates only the adapter name and that
`request` is `launch` or `attach`.

So a launch request built from the entry above arrives at vsdbg as:

```json
{"request":"launch","program":"<abs .dll>","cwd":"<abs dir>","env":{"ASPNETCORE_ENVIRONMENT":"Development"},
 "type":"coreclr","console":"internalConsole","justMyCode":true,"enableStepFiltering":true}
```

The last four are the proxy filling gaps in Zed's netcoredbg-shaped config, without overriding
anything you set: `type: "coreclr"`, `console: "internalConsole"`, `justMyCode: true`,
`enableStepFiltering: true`. The proxy also drops `label`, `adapter`, `build` and `tcp_connection` if
a future Zed ever does forward them.

- **`build`** is Zed's pre-launch task. It runs `dotnet build ...` and finishes before the adapter
  starts; it never appears in DAP traffic.
- **`env`** goes to the debuggee *and* to the `vsdbg-ui` process itself, which the extension spawns
  with that environment (`lib.rs:94`). Values are `<redacted>` in the proxy log — see
  `VSDBG_ZED_LOG_ENV`.
- **`cwd`** is likewise dual-purpose: the debuggee's working directory *and* the adapter process's,
  falling back to the worktree root when omitted (`lib.rs:95`).
- **`adapterID`** never comes from this file: Zed derives it from the adapter name being hijacked and
  sends `"netcoredbg"` in `initialize`, which vsdbg rejects with
  `Error processing 'initialize' request.` The proxy rewrites it to `coreclr` before forwarding.
- The `.dll`/`.exe` requirement lives only in the editor schema
  (`zed-netcoredbg/debug_adapter_schemas/netcoredbg.json:26-30`); nothing enforces it at runtime.

vsdbg-only keys (`sourceFileMap`, `symbolOptions`, `logging`, `requireExactSource`, `args`,
`stopAtEntry`) pass straight through for the same reason.

## Usage

```
vsdbg-zed           run as a debug adapter over stdio (this is what Zed invokes)
vsdbg-zed doctor    verify the wiring and the handshake end to end
npm test            unit tests for the Content-Length framer and the launch patch
```

`doctor` checks that `vsda.node` and `vsdbg-ui` are present, that vsda loads under your Node build,
that it produces the same signature shape as the nvim `vscode-signer.js`, and that a real
`vsdbg-ui` process handshakes and accepts the signature.

## Environment

| Variable | Default | Purpose |
|---|---|---|
| `VSDA_PATH` | `/usr/share/code/.../vsda/build/Release/vsda.node` | VS Code's signing addon |
| `VSDBG_PATH` | `~/.vscode/extensions/ms-dotnettools.csharp-*/.debugger/vsdbg-ui` | the debug adapter |
| `VSDBG_ZED_LOG` | `~/.cache/vsdbg-zed/shim.log` | full DAP trace; empty string disables |
| `VSDBG_ZED_NO_PATCH` | unset | forward `launch` exactly as Zed sent it |
| `VSDBG_ZED_LOG_ENV` | unset | log `env` values in full instead of `<redacted>` |

Bump `VSDBG_PATH` when the C# extension updates — the version is in the path.

## Troubleshooting

Read `~/.cache/vsdbg-zed/shim.log` first. `-->` is editor→adapter, `<--` is adapter→editor, `!!`
is a proxy decision, `err` is vsdbg's stderr.

| Symptom | Cause |
|---|---|
| No `handshake` in the log | Normal until a `launch` request is sent — vsdbg does not handshake at `initialize` |
| vsdbg exits right after our response | Signature rejected; `vsda.node` must match the installed VS Code build |
| Zed says the adapter exited, log is empty | Missing exec bit on `bin/vsdbg-zed.js`, or something wrote to stdout outside `frame()` |
| Launch fails but the handshake succeeded | Config mismatch — rerun with `VSDBG_ZED_NO_PATCH=1` and compare the `launch` body against a known-good one |
| `Error processing 'initialize' request.` | `adapterID` reached vsdbg as something other than `coreclr`. Look for `!! initialize adapterID rewritten` in the log; `VSDBG_ZED_NO_PATCH=1` reintroduces this failure by design |

`env` values are logged as `<redacted>` — keys are kept so a missing variable is still obvious. Set
`VSDBG_ZED_LOG_ENV=1` to see them in full; the log is plaintext, appended forever and never rotated,
so unset it again afterwards.

Never write to stdout outside `frame()` — stdout *is* the DAP stream, and a stray `console.log`
corrupts it. All diagnostics go to the log file.

## Licensing

vsdbg's EULA restricts it to Visual Studio, VS Code, and Visual Studio for Mac; the handshake is
that restriction's enforcement mechanism. [netcoredbg](https://github.com/Samsung/netcoredbg) is
the license-clean alternative and already works in Zed without any of this.
