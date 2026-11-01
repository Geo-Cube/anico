const {
  createService,
  installDependencies,
  normalizeName,
  registerDatabaseService,
  createBackendModule,
  createFrontendFeature,
} = require('./service.cjs');

module.exports = function generator(plop) {
  plop.setGenerator('module', {
    description: 'AniCo: add a domain module to an existing service',
    prompts: [
      {
        type: 'input',
        name: 'service',
        message: 'Service name (e.g. animal):',
      },
      { type: 'input', name: 'name', message: 'Module name (e.g. feeding):' },
    ],
    actions: [
      async (answers) => {
        const result = await createBackendModule(answers.service, answers.name);
        return `Created ${result.service}/src/modules/${result.name}. ${result.wired ? 'HTTP router registered.' : 'Connect the router in your custom composition root; see the generated module README.'}`;
      },
    ],
  });
  plop.setGenerator('feature', {
    description: 'AniCo: add a React feature without overwriting App',
    prompts: [
      {
        type: 'input',
        name: 'name',
        message: 'Feature name (e.g. animal-list):',
      },
    ],
    actions: [
      async (answers) => {
        const result = await createFrontendFeature(answers.name);
        return `Created frontend/src/features/${result.name}. Import ${result.component} where needed; see its README.`;
      },
    ],
  });
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
