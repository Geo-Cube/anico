try {
  const fs = require('node:fs');
  const admin = db.getSiblingDB('admin');
  admin.auth({
    user: fs.readFileSync('/run/secrets/root-username', 'utf8').trim(),
    pwd: fs.readFileSync('/run/secrets/root-password', 'utf8').trim(),
  });
  if (admin.runCommand({ ping: 1 }).ok !== 1) quit(1);
  quit(0);
} catch {
  quit(1);
}
