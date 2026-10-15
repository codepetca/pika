"""PRIVATE read-only macOS libproc identity query. No launch, signal or writes.
Compatibility constraint: macOS PRIVATE PROC_PIDT_BSDINFOWITHUNIQID=18,
proc_bsdinfo(136) + proc_uniqidentifierinfo(56) = 192 bytes. The unique-info
ABI is absent from the public installed SDK; CPU tests do not prove native
availability. A separate native compatibility check is required before use.
Pinned source: apple-oss-distributions/xnu f6217f891ac0bb64f3d375211650a4c1ff8ca1ea
bsd/sys/proc_info_private.h:45-60,149; bsd/kern/proc_info.c:1507,2238.
P_EXEC excludes inherited fork state, NOT unfinished pathname publication.
kern_exec.c initializes pidversion(1781/7096) and UUID(2190) before P_EXEC(2236);
p_textvp is published later. UUID/version pin an image generation, not a
completion event. uniqueid survives exec and changes on fork (kern_fork:978-997).
proc_pidpath observes a pathname only, never argv/title.
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

class Unique(C.Structure):
    _fields_ = [("uuid", C.c_ubyte * 16), ("uniqueid", C.c_uint64),
                ("puniqueid", C.c_uint64), ("pidversion", C.c_int32),
                ("orig_ppidversion", C.c_int32), ("reserve2", C.c_uint64),
                ("reserve3", C.c_uint64)]

class BSDUnique(C.Structure):
    _anonymous_ = ("bsd", "unique")
    _fields_ = [("bsd", BSD), ("unique", Unique)]

assert sys.platform == "darwin" and C.sizeof(BSD) == 136 and C.sizeof(Unique) == 56 and C.sizeof(BSDUnique) == 192
lib = C.CDLL("/usr/lib/libproc.dylib", use_errno=True)
lib.proc_pidinfo.argtypes = [C.c_int, C.c_int, C.c_uint64, C.c_void_p, C.c_int]
lib.proc_pidinfo.restype = C.c_int
lib.proc_pidpath.argtypes = [C.c_int, C.c_void_p, C.c_uint32]
lib.proc_pidpath.restype = C.c_int

def info(pid):
    value = BSDUnique()
    C.set_errno(0)
    return value if lib.proc_pidinfo(pid, 18, 0, C.byref(value), 192) == 192 else None

def query(row):
    pid, ppid, pgid = row
    unknown = dict(pid=pid, ppid=ppid, pgid=pgid, started="unverified",
                   executable="", uniqueId="", parentUniqueId="",
                   imageUuid="", pidVersion=None, state="unverified")
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
                            for k in ("pid", "ppid", "pgid", "sec", "usec", "uniqueid", "puniqueid")):
        return unknown
    if not (0 < after.uniqueid < 2**64 and 0 <= after.puniqueid < 2**64 and
            after.sec > 0 and 0 <= after.usec < 1000000):
        return unknown
    state = "zombie" if after.status == 5 else "exiting" if after.flags & 4 else "alive"
    try:
        executable = buf.value.decode("utf-8", "strict") if length > 0 else ""
    except UnicodeDecodeError:
        return unknown
    image_uuid, pid_version = bytes(after.uuid).hex(), after.pidversion
    if state == "alive" and not (before.flags & 0x4000 and after.flags & 0x4000):
        state, executable, image_uuid, pid_version = "starting", "", "", None
    elif (bytes(before.uuid) != bytes(after.uuid) or before.pidversion != after.pidversion or
          not any(after.uuid) or not -2**31 <= pid_version < 2**31):
        return unknown
    if state == "alive" and not executable:
        return unknown
    return dict(pid=pid, ppid=after.ppid, pgid=after.pgid,
                started=str(after.sec) + ":" + str(after.usec),
                executable=executable, uniqueId=str(after.uniqueid),
                parentUniqueId=str(after.puniqueid), imageUuid=image_uuid,
                pidVersion=pid_version, state=state)

raw = sys.stdin.buffer.read(1048577)
assert len(raw) <= 1048576
rows = json.loads(raw)
assert isinstance(rows, list) and len(rows) <= 20000
assert all(isinstance(r, list) and len(r) == 3 and
           all(type(v) is int and v >= 0 for v in r) and r[0] > 1 for r in rows)
assert len({r[0] for r in rows}) == len(rows)
print(json.dumps(dict(schema=3, rows=[q for r in rows if (q := query(r)) is not None]), separators=(",", ":")))
