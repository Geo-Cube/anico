/** Odstraní zrušený příznak; opakované spuštění již nic nemění. */
export async function up(connection) {
  await connection.db
    .collection('breeders')
    .updateMany(
      { hasBreedingStation: { $exists: true } },
      { $unset: { hasBreedingStation: '' } },
    );
}
