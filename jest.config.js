module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["**/__tests__/**/*-test.js?(x)", "**/__tests__/**/*-test.ts?(x)"],
  testPathIgnorePatterns: ["/node_modules/", "<rootDir>/dist/"]
};
