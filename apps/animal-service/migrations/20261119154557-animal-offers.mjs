/**
 * US-04 nabídky: nabídky jsou vnořené v `animals.offers[]` (stejně jako doklady, ADR-0005).
 * Index slouží vyhledání nabídky podle `offers._id` (stažení). Záměrně není partial: dotaz
 * podle `offers._id` by index s filtrem `offers.0` nepoužil. Bez backfillu – chybějící
 * pole znamená, že zvíře nemá žádnou nabídku.
 * @param {import('mongoose').Connection} connection
 */
export async function up(connection) {
  await connection.db
    .collection('animals')
    .createIndex({ 'offers._id': 1 }, { name: 'animals_offer_id' });
}
