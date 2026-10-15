"""PRIVATE read-only macOS libproc identity query. No launch, signal or writes.
ABI: installed SDK proc_bsdinfo(136 bytes), PROC_PIDTBSDINFO=3, SZOMB=5,
PROC_FLAG_INEXIT=4; proc_pidpath queries kernel executable, not argv/title.
P_EXEC is cleared on fork and set by exec; require it before AND after sampling:
https://github.com/apple-oss-distributions/xnu/blob/main/bsd/kern/kern_fork.c
https://github.com/apple-oss-distributions/xnu/blob/main/bsd/kern/kern_exec.c
https://github.com/apple-oss-distributions/xnu/blob/main/bsd/kern/proc_info.c
Input is bounded ps PID/parent/group inventory. Missing/inaccessible metadata
remains an unverified row, never a fabricated absence. Python -I -B required.
"""
import ctypes as C
import errno
import json
import sys

class BSD(C.Structure):
    _fields_ = [(name, C.c_uint32) for name in (
        "flags", "status", "xstatus", "pid", "ppid", "uid", "gid", "ruid",
        "rgid", "svuid", "svgid", "reserved")] + [
        ("comm", C.c_char * 16), ("name", C.c_char * 32)] + [
        (name, C.c_uint32) for name in ("nfiles", "pgid", "pjobc", "tdev", "tpgid")] + [
        ("nice", C.c_int32), ("sec", C.c_uint64), ("usec", C.c_uint64)]

assert sys.platform == "darwin" and C.sizeof(BSD) == 136
lib = C.CDLL("/usr/lib/libproc.dylib", use_errno=True)
lib.proc_pidinfo.argtypes = [C.c_int, C.c_int, C.c_uint64, C.c_void_p, C.c_int]
lib.proc_pidinfo.restype = C.c_int
lib.proc_pidpath.argtypes = [C.c_int, C.c_void_p, C.c_uint32]
lib.proc_pidpath.restype = C.c_int

def info(pid):
    value = BSD()
    C.set_errno(0)
    return value if lib.proc_pidinfo(pid, 3, 0, C.byref(value), 136) == 136 else None

def query(row):
    pid, ppid, pgid = row
    unknown = dict(pid=pid, ppid=ppid, pgid=pgid, started="unverified",
                   executable="", state="unverified")
    before = info(pid)
    if before is None:
        if C.get_errno() == errno.ESRCH and info(pid) is None and C.get_errno() == errno.ESRCH:
            return None
        return unknown
    if before.pid != pid or before.ppid != ppid or before.pgid != pgid:
        return unknown
    buf = C.create_string_buffer(4096)
    length = lib.proc_pidpath(pid, buf, 4096)
    after = info(pid)
    if after is None and C.get_errno() == errno.ESRCH and info(pid) is None and C.get_errno() == errno.ESRCH:
        return None
    if after is None or any(getattr(before, k) != getattr(after, k)
                            for k in ("pid", "ppid", "pgid", "sec", "usec")):
        return unknown
    state = "zombie" if after.status == 5 else "exiting" if after.flags & 4 else "alive"
    executable = buf.value.decode("utf-8", "strict") if length > 0 else ""
    if state == "alive" and not (before.flags & 0x4000 and after.flags & 0x4000):
        state, executable = "starting", ""
    if state == "alive" and not executable:
        return unknown
    return dict(pid=pid, ppid=after.ppid, pgid=after.pgid,
                started=str(after.sec) + ":" + str(after.usec),
                executable=executable, state=state)

raw = sys.stdin.buffer.read(1048577)
assert len(raw) <= 1048576
rows = json.loads(raw)
assert isinstance(rows, list) and len(rows) <= 20000
assert all(isinstance(r, list) and len(r) == 3 and
           all(type(v) is int and v >= 0 for v in r) and r[0] > 1 for r in rows)
assert len({r[0] for r in rows}) == len(rows)
print(json.dumps(dict(schema=2, rows=[q for r in rows if (q := query(r)) is not None]), separators=(",", ":")))
