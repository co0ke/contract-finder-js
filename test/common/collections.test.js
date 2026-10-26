import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { chunk, distinctBy, groupBy } from '../../src/common/collections.js';
import { isBlank } from '../../src/common/strings.js';

describe('collections', () => {
  it('DistinctBy_RepeatedKeys_KeepsFirstInOrder', () => {
    const items = [{ id: 'b', n: 1 }, { id: 'a', n: 2 }, { id: 'b', n: 3 }];

    assert.deepEqual(distinctBy(items, (i) => i.id), [{ id: 'b', n: 1 }, { id: 'a', n: 2 }]);
  });

  it('DistinctBy_Iterable_Works', () => {
    assert.deepEqual(distinctBy(new Set([1, 2, 3, 4]), (n) => n % 2), [1, 2]);
  });

  it('GroupBy_MixedKeys_GroupsInFirstAppearanceOrder', () => {
    const groups = groupBy(['apple', 'bean', 'avocado', 'corn'], (w) => w[0]);

    assert.deepEqual([...groups], [['a', ['apple', 'avocado']], ['b', ['bean']], ['c', ['corn']]]);
  });

  it('Chunk_ListLongerThanSize_SlicesWithShortTail', () => {
    assert.deepEqual([...chunk([1, 2, 3, 4, 5], 2)], [[1, 2], [3, 4], [5]]);
    assert.deepEqual([...chunk([], 2)], []);
  });

  it('Chunk_InvalidSize_Throws', () => {
    assert.throws(() => [...chunk([1], 0)], RangeError);
    assert.throws(() => [...chunk([1], 1.5)], RangeError);
  });
});

describe('strings', () => {
  for (const [value, expected] of [[null, true], [undefined, true], ['', true], ['  \t', true], ['x', false], [' x ', false], [0, false]]) {
    it(`IsBlank_${JSON.stringify(value)}_Is${expected}`, () => {
      assert.equal(isBlank(value), expected);
    });
  }
});
