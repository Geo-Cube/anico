const {
  createService,
  installDependencies,
  normalizeName,
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
        await installDependencies(result.root);
        return (
          `Created ${result.workspace}.\n` +
          `Local start: npm run dev -w ${result.workspace}\n` +
          `Configuration: apps/${result.name}/README.md\n` +
          'Remote DB accounts and deployment must be provisioned separately.'
        );
      },
    ],
  });
};
