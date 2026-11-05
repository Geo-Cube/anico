/**
 * UC-03 doklady (ADR-0005): verze dokladů jsou vnořené v `animals.documents[]`.
 * Index slouží frontě admina (aktuální PENDING verze, nejdéle čekající první).
 * @param {import('mongoose').Connection} connection
 */
export async function up(connection) {
  await connection.db.collection('animals').createIndex(
    {
      'documents.isCurrent': 1,
      'documents.assessmentStatus': 1,
      'documents.submittedAt': 1,
    },
    {
      name: 'animals_document_review_queue',
      partialFilterExpression: { 'documents.0': { $exists: true } },
    },
  );
}
