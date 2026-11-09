#!/usr/bin/env node
/**
 * Generates files for manual upload tests on dev (UC-01 certificate, UC-02
 * photos, UC-03 documents). Limits mirror the services; the README in the output
 * folder maps every file to the expected result.
 *
 *   npm run qa:fixtures [-- --out ./cesta]
 */
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import sharp from 'sharp';

const MiB = 1024 * 1024;
const CERTIFICATE_LIMIT = 5 * MiB; // breeder-service parse-upload.ts
const DOCUMENT_LIMIT = 10 * MiB; // animal-service animal-documents.ts
const PHOTO_LIMIT = 10 * MiB; // animal-service photos.ts

const { values } = parseArgs({
  options: { out: { type: 'string', default: '.qa-fixtures' } },
});
const out = resolve(values.out);

function pdf(label) {
  const text = `AniCo testovaci soubor: ${label}`;
  const stream = `BT /F1 18 Tf 50 750 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets = objects.map((object, index) => {
    const offset = body.length;
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets)
    body += `${String(offset).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

/** Pads a valid file after its end marker; parsers ignore the tail. */
function padTo(buffer, size) {
  if (buffer.length > size) throw new Error('Fixture is larger than target');
  return Buffer.concat([buffer, Buffer.alloc(size - buffer.length, 0x20)]);
}

const image = (width, height, rgb) =>
  sharp({ create: { width, height, channels: 3, background: rgb } });

const files = [];
const add = (name, content, expectation) =>
  files.push({ name, content, expectation });

const jpeg = await image(1200, 900, { r: 180, g: 120, b: 60 })
  .jpeg({ quality: 85 })
  .toBuffer();
const png = await image(800, 600, { r: 40, g: 110, b: 160 }).png().toBuffer();
const gif = await image(64, 64, { r: 200, g: 0, b: 0 }).gif().toBuffer();
// Noise keeps the large photo genuinely large instead of padded.
const noise = Buffer.alloc(4000 * 3000 * 3);
for (let i = 0; i < noise.length; i++) noise[i] = (i * 2654435761) >>> 24;
const bigPhoto = await sharp(noise, {
  raw: { width: 4000, height: 3000, channels: 3 },
})
  .jpeg({ quality: 92 })
  .toBuffer();

add(
  'platny-doklad.pdf',
  pdf('platny doklad'),
  'Doklad i certifikát: přijato (PDF).',
);
add(
  'platna-fotografie.jpg',
  jpeg,
  'Fotografie, doklad i certifikát: přijato (JPEG).',
);
add(
  'platna-fotografie.png',
  png,
  'Fotografie, doklad i certifikát: přijato (PNG).',
);
add(
  'velka-fotografie-4000x3000.jpg',
  bigPhoto,
  `Fotografie a doklad: přijato (${(bigPhoto.length / MiB).toFixed(1)} MiB), náhled fotografie se zmenší. Certifikát: 413 (nad 5 MiB).`,
);
add(
  'Průkaz původu – Žluťoučký kůň (2026) #1 & „test“ ěščřžýáíé.pdf',
  pdf('diakritika'),
  'Přijato; po stažení stejný název s diakritikou (UTF-8 `filename*`; náhradní ASCII název má podtržítka).',
);
add(
  `${'dlouhý-název-'.repeat(15)}konec.pdf`,
  pdf('dlouhy nazev'),
  'Přijato; název zkrácen na nejvýše 150 znaků a přípona .pdf zachována.',
);
add(
  'uvozovky "a" apostrof \'b\' středník; 🐕‍🦺.pdf',
  pdf('specialni znaky'),
  'Přijato; uvozovky a neviditelný spojovač emoji (ZWJ) odstraněny, ostatní znaky zachovány; stažení jako příloha.',
);
add(
  'skutecne-pdf-pojmenovane.exe',
  pdf('pdf s priponou exe'),
  'Doklad/certifikát: přijato jako PDF (rozhoduje obsah, ne přípona). Fotografie: 415. Stažení jako příloha, nikdy se nespustí.',
);
add(
  'podvrzene-html.pdf',
  Buffer.from('<!doctype html><script>alert("AniCo")</script>\n'),
  'Vše: odmítnuto 415 (HTML s příponou .pdf).',
);
add(
  'podvrzene-html.jpg',
  Buffer.from('<html><body>falesny obrazek</body></html>\n'),
  'Vše: odmítnuto 415.',
);
add('prazdny.pdf', Buffer.alloc(0), 'Vše: odmítnuto 415 (prázdný soubor).');
add('animace.gif', gif, 'Vše: odmítnuto 415 (GIF není povolen).');
add(
  'poskozena-fotografie.jpg',
  Buffer.concat([jpeg.subarray(0, 4), Buffer.alloc(2048, 0x41)]),
  'Fotografie: 415 (hlavička JPEG, ale nečitelný obrázek). Doklad i certifikát: přijato (kontroluje se jen hlavička).',
);
add(
  'certifikat-presne-5MiB.pdf',
  padTo(pdf('5 MiB'), CERTIFICATE_LIMIT),
  'Certifikát: přijato (přesně limit 5 MiB).',
);
add(
  'certifikat-5MiB-plus-1B.pdf',
  padTo(pdf('5 MiB + 1 B'), CERTIFICATE_LIMIT + 1),
  'Certifikát: 413, nic se neuloží. Doklad: přijato. Fotografie: 415.',
);
add(
  'doklad-presne-10MiB.pdf',
  padTo(pdf('10 MiB'), DOCUMENT_LIMIT),
  'Doklad: přijato (přesně limit 10 MiB). Certifikát: 413. Fotografie: 415.',
);
add(
  'doklad-10MiB-plus-1B.pdf',
  padTo(pdf('10 MiB + 1 B'), DOCUMENT_LIMIT + 1),
  'Doklad: 413, nic se neuloží (ani ostatní soubory v podání).',
);
add(
  'fotografie-presne-10MiB.jpg',
  padTo(jpeg, PHOTO_LIMIT),
  'Fotografie a doklad: přijato (přesně limit 10 MiB). Certifikát: 413.',
);
add(
  'fotografie-10MiB-plus-1B.jpg',
  padTo(jpeg, PHOTO_LIMIT + 1),
  'Fotografie: 413, profil ani ostatní fotografie se neuloží.',
);

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
for (const file of files)
  await writeFile(resolve(out, file.name), file.content);
const rows = files.map(
  (file) =>
    `| \`${file.name.replaceAll('|', '\\|')}\` | ${file.content.length} B | ${file.expectation} |`,
);
await writeFile(
  resolve(out, 'README.md'),
  [
    '# Testovací soubory pro nahrávání',
    '',
    'Vygenerováno `npm run qa:fixtures`. Limity: certifikát UC-01 5 MiB; doklad UC-03',
    'a fotografie UC-02 10 MiB na soubor. Typ se určuje podle obsahu.',
    'Scénáře: `docs/qa/dev-testovani.md`.',
    '',
    '| Soubor | Velikost | Očekávání |',
    '| --- | --- | --- |',
    ...rows,
    '',
  ].join('\n'),
);
console.log(`${files.length} souborů v ${out}`);
