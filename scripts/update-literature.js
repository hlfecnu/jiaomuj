const { DEFAULTS, collectLiterature } = require("../server");

async function main() {
  const result = await collectLiterature(DEFAULTS);
  console.log(`Updated ${result.articles.length} articles at ${result.updatedAt}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
