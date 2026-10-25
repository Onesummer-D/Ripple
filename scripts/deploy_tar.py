import io, os, sys, tarfile, paramiko

HOST = os.environ['SSH_HOST']
USER = os.environ['SSH_USER']
PASS = os.environ['SSH_PASS']
LOCAL = sys.argv[1].rstrip('/')          # .../dist-demo (Windows 路径，本机使用)
REMOTE_DIR = '/var/www/ripple-demo'      # 远端 web 根（硬编码，避免 Git Bash 的 MSYS2 路径转换）
REMOTE_TAR = 'ripple-deploy.tar.gz'

# 1) 本地打包 dist-demo 为 tar.gz（内存）
buf = io.BytesIO()
with tarfile.open(fileobj=buf, mode='w:gz') as tf:
    tf.add(LOCAL, arcname=os.path.basename(LOCAL))
data = buf.getvalue()
print('local archive bytes:', len(data))

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USER, password=PASS, timeout=30, look_for_keys=False, allow_agent=False)

# 2) SFTP 上传单文件到 home（相对路径，已验证可用）
sftp = client.open_sftp()
sftp.putfo(io.BytesIO(data), REMOTE_TAR)
print('sftp put', REMOTE_TAR, 'OK')
sftp.close()

# 3) exec 解压（从文件读，避开 stdin 流式问题）
cmd = f'cd {REMOTE_DIR} && tar -xzf ~/{REMOTE_TAR} --strip-components=1 && echo TAR_OK && rm -f ~/{REMOTE_TAR}'
stdin, stdout, stderr = client.exec_command(cmd, timeout=120)
out = stdout.read().decode(errors='replace')
err = stderr.read().decode(errors='replace')
exit_code = stdout.channel.recv_exit_status()
client.close()
print('=== remote tar stderr ===', err.strip())
print('=== remote tar stdout ===', out.strip())
print('=== EXIT', exit_code, '===')
sys.exit(0 if exit_code == 0 else 1)
