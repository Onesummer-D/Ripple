import os, sys, paramiko

HOST = os.environ['SSH_HOST']
USER = os.environ['SSH_USER']
PASS = os.environ['SSH_PASS']
CMD = sys.argv[1]
TIMEOUT = int(os.environ.get('SSH_TIMEOUT', '180'))

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USER, password=PASS, timeout=30, look_for_keys=False, allow_agent=False)
stdin, stdout, stderr = client.exec_command(CMD, timeout=TIMEOUT)
out = stdout.read().decode(errors='replace')
err = stderr.read().decode(errors='replace')
exit_code = stdout.channel.recv_exit_status()
client.close()
sys.stdout.write("=== STDOUT ===\n")
sys.stdout.write(out)
sys.stdout.write("=== STDERR ===\n")
sys.stdout.write(err)
sys.stdout.write(f"=== EXIT {exit_code} ===\n")
sys.exit(0)
