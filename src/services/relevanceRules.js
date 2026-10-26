import { Relevance } from '../models/job.js';

// ".NET" needs its dot, so "network" and "net salary" don't match; "VB.NET" and "ASP.NET" do.
const OurStack = /\.net(?![a-z])|\bdotnet\b|\bc#|\bc ?sharp\b|\bazure\b|\bblazor\b/i;

// Whole words only: "java" doesn't match inside "JavaScript", which has its own term.
const OtherStack = new RegExp(
  String.raw`\bjava\b|\bkotlin\b|\bscala\b|\bgolang\b|\bgo (?:developer|engineer)\b|\(go\)|\bpython\b|\bdjango\b|\bruby\b|\brails\b|\bphp\b|\blaravel\b` +
  String.raw`|\bnode(?:\.?js)?\b|\bjavascript\b|\btypescript\b|\breact\b|\bangular\b|\bvue\b|\brust\b|\bc\+\+|\belixir\b|\bios\b|\bandroid\b` +
  String.raw`|\bsalesforce\b|\bsap\b`,
  'i');

const SoftwareRole = /\bsoftware\b|\bdeveloper\b|\bprogrammer\b|\bback[- ]?end\b|\bfull[- ]?stack\b/i;

/**
 * Decides whether an advert is worth listing, from its title and snippet. Sources search broadly
 * (".NET" is also read as "net", "software engineer" matches every stack), so these rules decide relevance.
 */
export const RelevanceRules = Object.freeze({
  /**
   * @param {import('../models/job.js').Job} job
   * @returns {keyof typeof Relevance}
   */
  classify(job) {
    const text = `${job.title}\n${job.snippet ?? ''}`;
    if (OurStack.test(text)) {
      return Relevance.StackMatch;
    }
    if (OtherStack.test(text)) {
      return Relevance.OtherStack;
    }
    return SoftwareRole.test(job.title) ? Relevance.Generic : Relevance.Unrelated;
  },

  /** @param {keyof typeof Relevance} relevance */
  isListed(relevance) {
    return relevance === Relevance.StackMatch || relevance === Relevance.Generic;
  },
});
