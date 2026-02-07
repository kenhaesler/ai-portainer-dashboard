import os
import shlex
import subprocess

from mcp.server.fastmcp import FastMCP

HOST = os.getenv("MCP_HOST", "0.0.0.0")
PORT = int(os.getenv("MCP_PORT", "8000"))
MAX_TIMEOUT = 30
ALLOWED_COMMANDS = set(
    os.getenv("ALLOWED_COMMANDS", "whoami,id,uname,ip,df,free,ps,ss,ls,cat").split(",")
)
ALLOW_ALL_COMMANDS = "all" in {cmd.strip().lower() for cmd in ALLOWED_COMMANDS}

mcp = FastMCP(
    "kali-lab-mcp",
    stateless_http=True,
    json_response=True,
    host=HOST,
    port=PORT,
)


@mcp.tool()
def run_allowed(cmd: str, timeout_sec: int = 10) -> str:
    """Run one allowlisted command inside the container."""
    parts = shlex.split(cmd)
    if not parts:
        return "Empty command."

    if not ALLOW_ALL_COMMANDS and parts[0] not in ALLOWED_COMMANDS:
        return f"Blocked. Allowed commands: {', '.join(sorted(ALLOWED_COMMANDS))}"

    timeout = max(1, min(timeout_sec, MAX_TIMEOUT))
    proc = subprocess.run(parts, capture_output=True, text=True, timeout=timeout, check=False)

    out = proc.stdout[-6000:]
    err = proc.stderr[-2000:]
    return f"exit={proc.returncode}\nstdout:\n{out}\nstderr:\n{err}"


@mcp.resource("kali://os-release")
def os_release() -> str:
    """Return OS metadata from /etc/os-release."""
    with open("/etc/os-release", "r", encoding="utf-8") as f:
        return f.read()


if __name__ == "__main__":
    mcp.run(transport="streamable-http")
