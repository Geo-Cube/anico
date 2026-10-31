const {
  createService,
  installDependencies,
  normalizeName,
  registerDatabaseService,
} = require('./service.cjs');

module.exports = function generator(plop) {
  plop.setGenerator('service', {
    description: 'AniCo: Express + TypeScript + Mongoose service',
    prompts: [
      {
        type: 'input',
        name: 'name',
        message: 'Název služby (např. animal nebo animal-service):',
        validate(value) {
          try {
            normalizeName(value);
            return true;
          } catch (error) {
            return error.message;
          }
        },
      },
    ],
    actions: [
      async (answers) => {
        const result = await createService(answers.name);
        await registerDatabaseService(result.name, result.root);
        await installDependencies(result.root);
        return (
          `Created ${result.workspace}.\n` +
          `Local start: npm run dev -w ${result.workspace}\n` +
          `Configuration: apps/${result.name}/README.md\n` +
          'DB service registered. Administrator must apply deploy:dev-database to grant remote access; deployment is configured separately.'
        );
      },
    ],
  });
};
