module.exports = {
  moduleFileExtensions: ["js", "json", "ts"],
  rootDir: ".",
  testRegex: ".*\\.spec\\.ts$",
  transform: { "^.+\\.tsx?$": "ts-jest" },
  collectCoverageFrom: ["apps/**/*.ts", "libs/**/*.ts"],
  coverageDirectory: "coverage",
};
