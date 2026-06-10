/** @type {import('jest').Config} */
const config = {
  testEnvironment: "node",
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        tsconfig: "tsconfig.test.json",
        diagnostics: { ignoreCodes: [151002] },
      },
    ],
  },

  // Ersetzt fehlende Runtime-Module durch Mocks
  moduleNameMapper: {
    "^vscode$": "<rootDir>/__mocks__/vscode.ts",
    "^micropython\\.js$": "<rootDir>/__mocks__/micropython-js.ts",
  },

  // Testdateien
  testMatch: [
    "<rootDir>/src/test/unit/**/*.test.ts",
    "<rootDir>/src/test/integration/**/*.test.ts",
  ],

  // Kein Build-Output testen
  testPathIgnorePatterns: ["/node_modules/", "/out/", "/dist/"],

  // Coverage nur für produktiven Code
  collectCoverageFrom: ["src/**/*.ts", "!src/test/**", "!src/types/**"],
  coverageDirectory: "coverage",
  coverageReporters: ["text", "cobertura", "lcov"],

  // JUnit-Report für GitLab CI
  reporters: ["default", ["jest-junit", { outputFile: "junit-unit.xml" }]],
};

module.exports = config;
