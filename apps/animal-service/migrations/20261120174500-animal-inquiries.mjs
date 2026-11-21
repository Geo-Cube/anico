/**
 * Poptávky UC-07 jsou vnořené v `animals.offers[].inquiries[]`.
 * Indexy zrychlují dohledání poptávek podle odesílatele; nabídky podle
 * `offers._id` už obstarává migrace `20261119154557-animal-offers.mjs`.
 * @param {import('mongoose').Connection} connection
 */
export async function up(connection) {
  await connection.db
    .collection('animals')
    .createIndex(
      { 'offers.inquiries.senderBreederId': 1 },
      { name: 'animals_offer_inquiry_sender' },
    );
  await connection.db
    .collection('animals')
    .createIndex(
      { 'offers.inquiries._id': 1 },
      { name: 'animals_offer_inquiry_id' },
    );
}
