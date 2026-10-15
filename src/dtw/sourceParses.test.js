// Every source file under src/ must parse.
//
// ReferenceExtractor.js is imported only by index.js, so no test ever loaded it
// and a syntax error in it passed a full green suite while the dev server
// served "Module build failed" to the browser. A parse sweep is the cheapest
// thing that makes the test run tell the truth about files nothing imports.
import fs from 'fs';
import path from 'path';
import { parse } from '@babel/parser';

function sourceFiles(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== '__fixtures__') sourceFiles(full, acc);
    } else if (entry.name.endsWith('.js') && !entry.name.endsWith('.test.js')) {
      acc.push(full);
    }
  }
  return acc;
}

describe('every source file parses', () => {
  const files = sourceFiles('src');

  it('finds the files to check', () => {
    expect(files.length).toBeGreaterThan(20);
    expect(files).toContain(path.join('src', 'dtw', 'ReferenceExtractor.js'));
  });

  it.each(files)('%s', (file) => {
    expect(() => parse(fs.readFileSync(file, 'utf8'), {
      sourceType: 'module',
      plugins: ['jsx'],
    })).not.toThrow();
  });
});
