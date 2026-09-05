process.stdout.write(Buffer.from(process.argv[2], 'base64'));
if (process.argv[3]) {
  process.stdin.once('data', () => process.stdout.write(Buffer.from(process.argv[3], 'base64')));
}
// Remain alive like an interactive agent; returning to the shell resets agent activity.
setInterval(() => {}, 1000);
