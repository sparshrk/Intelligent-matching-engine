/**
 * Intelligent Matching Engine
 * 
 * Multi-criteria weighted scoring algorithm for matching entities
 * (e.g., lenders to applicants) based on eligibility, compatibility,
 * and preference signals.
 */

export interface EligibilityCriteria {
  personalProfile?: {
    nationality?: { eligibleCountries: string[] };
    minAge?: number;
    maxAge?: number;
  };
  financialProfile?: {
    minAmount?: number;
    maxAmount?: number;
    supportedCurrencies?: string[];
  };
  academicProfile?: {
    minPercentage?: number;
    acceptedQualifications?: string[];
  };
  destinationProfile?: {
    eligibleDestinations?: string[];
  };
}

export interface ProviderProfile {
  id: string;
  name: string;
  status: 'active' | 'inactive';
  eligibilityCriteria: EligibilityCriteria;
  interestRate?: number;
  processingTimeDays?: number;
  maxCoverage?: number;
  metadata?: Record<string, any>;
}

export interface ApplicantProfile {
  id: string;
  nationality?: string;
  nationalityCode?: string;
  phoneNumber?: string;
  age?: number;
  requestedAmount?: number;
  currency?: string;
  academicPercentage?: number;
  qualification?: string;
  destinationCountry?: string;
  destinationCode?: string;
  metadata?: Record<string, any>;
}

export interface MatchResult {
  provider: ProviderProfile;
  matchScore: number;
  matchReasons: string[];
  disqualifyReasons: string[];
  isEligible: boolean;
  breakdown: ScoreBreakdown;
}

export interface ScoreBreakdown {
  nationalityScore: number;
  financialScore: number;
  academicScore: number;
  destinationScore: number;
  bonusScore: number;
}

interface ScoringWeights {
  nationality: number;
  financial: number;
  academic: number;
  destination: number;
  bonus: number;
}

interface CountryResolution {
  isoCode: string | null;
  countryName: string;
}

export type CountryResolver = (input: string) => CountryResolution | null;
export type CurrencyConverter = (amount: number, from: string, to: string) => number;

const DEFAULT_WEIGHTS: ScoringWeights = {
  nationality: 20,
  financial: 25,
  academic: 20,
  destination: 20,
  bonus: 15
};

export class MatchingEngine {
  private weights: ScoringWeights;
  private countryResolver?: CountryResolver;
  private currencyConverter?: CurrencyConverter;

  constructor(options?: {
    weights?: Partial<ScoringWeights>;
    countryResolver?: CountryResolver;
    currencyConverter?: CurrencyConverter;
  }) {
    this.weights = { ...DEFAULT_WEIGHTS, ...options?.weights };
    this.countryResolver = options?.countryResolver;
    this.currencyConverter = options?.currencyConverter;
  }

  /**
   * Match an applicant against all providers, returning ranked results
   */
  matchAll(providers: ProviderProfile[], applicant: ApplicantProfile): MatchResult[] {
    return providers
      .filter(p => p.status === 'active')
      .map(provider => this.matchSingle(provider, applicant))
      .sort((a, b) => b.matchScore - a.matchScore);
  }

  /**
   * Match an applicant against a single provider
   */
  matchSingle(provider: ProviderProfile, applicant: ApplicantProfile): MatchResult {
    const reasons: string[] = [];
    const disqualifyReasons: string[] = [];
    let isEligible = true;

    const breakdown: ScoreBreakdown = {
      nationalityScore: 0,
      financialScore: 0,
      academicScore: 0,
      destinationScore: 0,
      bonusScore: 0
    };

    // --- Nationality Check (mandatory) ---
    const nationalityResult = this.scoreNationality(provider, applicant);
    breakdown.nationalityScore = nationalityResult.score;
    if (nationalityResult.disqualified) {
      isEligible = false;
      disqualifyReasons.push(nationalityResult.reason);
    } else if (nationalityResult.reason) {
      reasons.push(nationalityResult.reason);
    }

    // --- Financial Check ---
    const financialResult = this.scoreFinancial(provider, applicant);
    breakdown.financialScore = financialResult.score;
    if (financialResult.disqualified) {
      isEligible = false;
      disqualifyReasons.push(financialResult.reason);
    } else if (financialResult.reason) {
      reasons.push(financialResult.reason);
    }

    // --- Academic Check ---
    const academicResult = this.scoreAcademic(provider, applicant);
    breakdown.academicScore = academicResult.score;
    if (academicResult.reason) reasons.push(academicResult.reason);

    // --- Destination Check ---
    const destinationResult = this.scoreDestination(provider, applicant);
    breakdown.destinationScore = destinationResult.score;
    if (destinationResult.reason) reasons.push(destinationResult.reason);

    // --- Bonus Signals ---
    breakdown.bonusScore = this.scoreBonusSignals(provider, applicant);
    if (breakdown.bonusScore > 0) reasons.push('Additional compatibility signals matched');

    const totalScore = isEligible
      ? breakdown.nationalityScore + breakdown.financialScore +
        breakdown.academicScore + breakdown.destinationScore + breakdown.bonusScore
      : 0;

    return {
      provider,
      matchScore: totalScore,
      matchReasons: reasons,
      disqualifyReasons,
      isEligible,
      breakdown
    };
  }

  private scoreNationality(provider: ProviderProfile, applicant: ApplicantProfile): {
    score: number; disqualified: boolean; reason: string;
  } {
    const eligible = provider.eligibilityCriteria?.personalProfile?.nationality?.eligibleCountries || [];
    if (eligible.length === 0) {
      return { score: this.weights.nationality * 0.5, disqualified: false, reason: 'No nationality restriction' };
    }

    const userCountry = applicant.nationalityCode || applicant.nationality;
    if (!userCountry) {
      return { score: this.weights.nationality * 0.25, disqualified: false, reason: 'Nationality pending verification' };
    }

    // Direct match by code or name
    const matches = eligible.some(c =>
      c.toLowerCase() === userCountry.toLowerCase()
    );

    // Try resolving via country resolver
    if (!matches && this.countryResolver) {
      const resolved = this.countryResolver(userCountry);
      if (resolved) {
        const resolvedMatch = eligible.some(c =>
          c.toLowerCase() === resolved.isoCode?.toLowerCase() ||
          c.toLowerCase() === resolved.countryName.toLowerCase()
        );
        if (resolvedMatch) {
          return { score: this.weights.nationality, disqualified: false, reason: `Nationality eligible (${resolved.countryName})` };
        }
      }
    }

    if (matches) {
      return { score: this.weights.nationality, disqualified: false, reason: `Nationality eligible (${userCountry})` };
    }

    return { score: 0, disqualified: true, reason: `Nationality ${userCountry} not in eligible list` };
  }

  private scoreFinancial(provider: ProviderProfile, applicant: ApplicantProfile): {
    score: number; disqualified: boolean; reason: string;
  } {
    const criteria = provider.eligibilityCriteria?.financialProfile;
    if (!criteria) {
      return { score: this.weights.financial * 0.5, disqualified: false, reason: 'No financial restrictions' };
    }

    let amount = applicant.requestedAmount || 0;

    // Currency conversion if needed
    if (amount > 0 && applicant.currency && criteria.supportedCurrencies && this.currencyConverter) {
      if (!criteria.supportedCurrencies.includes(applicant.currency)) {
        amount = this.currencyConverter(amount, applicant.currency, 'USD');
      }
    }

    if (criteria.minAmount && amount < criteria.minAmount) {
      return { score: 0, disqualified: true, reason: `Amount ${amount} below minimum ${criteria.minAmount}` };
    }

    if (criteria.maxAmount && amount > criteria.maxAmount) {
      return { score: 0, disqualified: true, reason: `Amount ${amount} exceeds maximum ${criteria.maxAmount}` };
    }

    if (amount > 0) {
      return { score: this.weights.financial, disqualified: false, reason: 'Financial criteria met' };
    }

    return { score: this.weights.financial * 0.25, disqualified: false, reason: 'Amount pending' };
  }

  private scoreAcademic(provider: ProviderProfile, applicant: ApplicantProfile): {
    score: number; reason: string;
  } {
    const criteria = provider.eligibilityCriteria?.academicProfile;
    if (!criteria) return { score: this.weights.academic * 0.5, reason: '' };

    let score = 0;

    if (criteria.minPercentage && applicant.academicPercentage) {
      if (applicant.academicPercentage >= criteria.minPercentage) {
        score += this.weights.academic * 0.7;
      } else {
        return { score: 0, reason: `Academic percentage ${applicant.academicPercentage}% below minimum ${criteria.minPercentage}%` };
      }
    }

    if (criteria.acceptedQualifications && applicant.qualification) {
      if (criteria.acceptedQualifications.some(q => q.toLowerCase() === applicant.qualification!.toLowerCase())) {
        score += this.weights.academic * 0.3;
      }
    }

    return {
      score: score || this.weights.academic * 0.25,
      reason: score > 0 ? 'Academic criteria met' : ''
    };
  }

  private scoreDestination(provider: ProviderProfile, applicant: ApplicantProfile): {
    score: number; reason: string;
  } {
    const eligible = provider.eligibilityCriteria?.destinationProfile?.eligibleDestinations || [];
    if (eligible.length === 0) return { score: this.weights.destination * 0.5, reason: '' };

    const dest = applicant.destinationCountry || applicant.destinationCode;
    if (!dest) return { score: this.weights.destination * 0.25, reason: '' };

    const matches = eligible.some(d => d.toLowerCase() === dest.toLowerCase());
    return matches
      ? { score: this.weights.destination, reason: `Destination ${dest} supported` }
      : { score: 0, reason: `Destination ${dest} not supported` };
  }

  private scoreBonusSignals(provider: ProviderProfile, applicant: ApplicantProfile): number {
    let bonus = 0;

    // Fast processing bonus
    if (provider.processingTimeDays && provider.processingTimeDays <= 7) {
      bonus += this.weights.bonus * 0.3;
    }

    // High coverage bonus
    if (provider.maxCoverage && provider.maxCoverage >= 90) {
      bonus += this.weights.bonus * 0.3;
    }

    // Low interest rate bonus
    if (provider.interestRate && provider.interestRate < 8) {
      bonus += this.weights.bonus * 0.4;
    }

    return bonus;
  }
}
