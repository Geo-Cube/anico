/**
 * Jméno zvířete je povinné dle rozhodnutí vlastníka produktu z 2026-11-06.
 * Chybějící jméno nelze odvodit; záznamy se nemění a migrace se zastaví.
 * @param {import('mongoose').Connection} connection
 */
export async function up(connection) {
  const missingName = await connection.db.collection('animals').countDocuments({
    $or: [{ name: null }, { name: { $regex: '^\\s*$' } }],
  });
  if (missingName > 0)
    throw new Error(
      `${missingName} animal(s) have a missing, null or blank name; set a non-blank name, then rerun the migration`,
    );
}
