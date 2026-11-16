/**
 * SMA Indicator Tests
 */

import { calculateSMA, calculateSMABatch, detectSMACrossover, detectDualSMACrossover, generatePeriodRange } from '../../src/lib/indicators/sma';

describe('calculateSMA', () => {
  test('calculates correct SMA for simple data', () => {
    const data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const result = calculateSMA(data, 3);
    
    expect(result[0]).toBeNull();
    expect(result[1]).toBeNull();
    expect(result[2]).toBeCloseTo(2, 10);  // (1+2+3)/3
    expect(result[3]).toBeCloseTo(3, 10);  // (2+3+4)/3
    expect(result[9]).toBeCloseTo(9, 10);  // (8+9+10)/3
  });

  test('returns all null for insufficient data', () => {
    const result = calculateSMA([1, 2], 5);
    expect(result.every(v => v === null)).toBe(true);
  });

  test('handles period of 1', () => {
    const data = [10, 20, 30];
    const result = calculateSMA(data, 1);
    expect(result[0]).toBe(10);
    expect(result[1]).toBe(20);
    expect(result[2]).toBe(30);
  });

  test('throws on invalid period', () => {
    expect(() => calculateSMA([1, 2, 3], 0)).toThrow();
    expect(() => calculateSMA([1, 2, 3], -1)).toThrow();
    expect(() => calculateSMA([1, 2, 3], 1.5)).toThrow();
  });

  test('handles non-standard integer periods (e.g., 37, 73)', () => {
    const data = Array.from({ length: 100 }, (_, i) => Math.sin(i * 0.1) * 50 + 100);
    const sma37 = calculateSMA(data, 37);
    const sma73 = calculateSMA(data, 73);
    
    expect(sma37[36]).not.toBeNull();
    expect(sma37[35]).toBeNull();
    expect(sma73[72]).not.toBeNull();
    expect(sma73[71]).toBeNull();
  });
});

describe('calculateSMABatch', () => {
  test('calculates multiple periods at once', () => {
    const data = Array.from({ length: 50 }, (_, i) => i + 1);
    const results = calculateSMABatch(data, [5, 10, 20]);
    
    expect(results.size).toBe(3);
    expect(results.get(5)![4]).toBeCloseTo(3, 10); // (1+2+3+4+5)/5
    expect(results.get(10)![9]).toBeCloseTo(5.5, 10); // (1..10)/10
  });
});

describe('detectSMACrossover', () => {
  test('detects bullish crossover', () => {
    const price = [10, 8, 6, 8, 12]; // crosses above SMA
    const sma: (number | null)[] = [null, null, 9, 9, 9];
    const signals = detectSMACrossover(price, sma);
    
    expect(signals[4]).toBe(1); // price crosses above at index 4
  });

  test('detects bearish crossover', () => {
    const price = [12, 10, 11, 8, 6];
    const sma: (number | null)[] = [null, null, 9, 9, 9];
    const signals = detectSMACrossover(price, sma);
    
    expect(signals[3]).toBe(-1); // price crosses below
  });
});

describe('detectDualSMACrossover', () => {
  test('detects golden cross', () => {
    const fast: (number | null)[] = [null, 8, 9, 11, 12];
    const slow: (number | null)[] = [null, 9, 10, 10, 10];
    const signals = detectDualSMACrossover(fast, slow);
    
    expect(signals[3]).toBe(1); // fast crosses above slow
  });

  test('detects death cross', () => {
    const fast: (number | null)[] = [null, 12, 11, 9, 8];
    const slow: (number | null)[] = [null, 10, 10, 10, 10];
    const signals = detectDualSMACrossover(fast, slow);
    
    expect(signals[3]).toBe(-1); // fast crosses below slow
  });
});

describe('generatePeriodRange', () => {
  test('generates correct range', () => {
    const range = generatePeriodRange(5, 10);
    expect(range).toEqual([5, 6, 7, 8, 9, 10]);
  });

  test('handles minimum period of 2', () => {
    const range = generatePeriodRange(1, 5);
    expect(range).toEqual([2, 3, 4, 5]);
  });
});
