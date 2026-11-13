// Načítá se přes `node --import` jen v procesech služeb spuštěných E2E launcherem.
// Launcher drží stdin dítěte otevřený; jeho zánik (i SIGKILL) stdin zavře a služba
// se ukončí vlastním SIGTERM handlerem, takže po pádu běhu nezůstanou procesy.
process.stdin.once('end', () => process.kill(process.pid, 'SIGTERM'));
process.stdin.once('error', () => process.kill(process.pid, 'SIGTERM'));
process.stdin.resume();
process.stdin.unref();
