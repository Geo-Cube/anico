/**
 * UC-02 profil podle Products: pohlaví je jen `male` | `female`. Hodnotu `unknown` ze základu
 * animal-service nelze převést bez rozhodnutí chovatele, proto migrace takové záznamy nemění
 * a zastaví se. Ostatní nová pole (`coatColor`, `weightKg`, `photos`, …) chybějící údaj čte
 * jako `null` / prázdný seznam, takže stávající záznamy úpravu nepotřebují.
 * @param {import('mongoose').Connection} connection
 */
export async function up(connection) {
  const unknownSex = await connection.db
    .collection('animals')
    .countDocuments({ sex: { $nin: ['male', 'female'] } });
  if (unknownSex > 0)
    throw new Error(
      `${unknownSex} animal(s) have a sex other than male/female; set it to male or female, then rerun the migration`,
    );
}
