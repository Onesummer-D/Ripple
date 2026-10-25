import io, os, sys, tarfile, paramiko

HOST = os.environ['SSH_HOST']; USER=os.environ['SSH_USER']; PASS=os.environ['SSH_PASS']

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USER, password=PASS, timeout=30, look_for_keys=False, allow_agent=False)

print("=== SFTP probe ===")
sftp = client.open_sftp()
try:
    print("listdir('.') ->", sftp.listdir('.'))
except Exception as e:
    print("listdir('.') ERR", repr(e))
try:
    st = sftp.stat('/var/www/ripple-demo')
    print("stat /var/www/ripple-demo OK", st)
except Exception as e:
    print("stat /var/www/ripple-demo ERR", repr(e))
try:
    sftp.putfo(io.BytesIO(b'hello-probe'), 'ripple-probe.txt')
    print("putfo relative ripple-probe.txt OK")
except Exception as e:
    print("putfo relative ERR", repr(e))
try:
    print("read ripple-probe.txt ->", sftp.open('ripple-probe.txt').read())
except Exception as e:
    print("read relative ERR", repr(e))
sftp.close()

print("=== exec stdin probe (cat) ===")
try:
    stdin, stdout, stderr = client.exec_command('cat > /tmp/ripple-probe2.txt; echo CAT_DONE', timeout=30)
    stdin.write(b'hello-stdin\n')
    stdin.flush(); stdin.channel.shutdown_write()
    print("stdout:", stdout.read().decode())
    print("stderr:", stderr.read().decode())
    print("exit:", stdout.channel.recv_exit_status())
except Exception as e:
    print("exec stdin ERR", repr(e))
client.close()
