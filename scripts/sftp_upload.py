import os, sys, paramiko

HOST = os.environ['SSH_HOST']
USER = os.environ['SSH_USER']
PASS = os.environ['SSH_PASS']
LOCAL = sys.argv[1].rstrip('/')
REMOTE = sys.argv[2].rstrip('/')

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, username=USER, password=PASS, timeout=30, look_for_keys=False, allow_agent=False)
sftp = ssh.open_sftp()

def ensure_dir(path):
    parts = [p for p in path.split('/') if p]
    cur = ''
    for p in parts:
        cur = (cur + '/' + p) if cur else ('/' + p)
        try:
            sftp.mkdir(cur)
        except Exception:
            pass
        try:
            sftp.chmod(cur, 0o755)
        except Exception:
            pass

def walk(local, remote):
    for name in sorted(os.listdir(local)):
        lp = os.path.join(local, name)
        rp = remote + '/' + name
        if os.path.isdir(lp):
            ensure_dir(rp)
            walk(lp, rp)
        else:
            ensure_dir(os.path.dirname(rp))
            sftp.put(lp, rp)
            sftp.chmod(rp, 0o644)
            print('put', rp)

ensure_dir(REMOTE)
walk(LOCAL, REMOTE)
sftp.close()
ssh.close()
print('UPLOAD DONE:', LOCAL, '->', REMOTE)
