// src/compliance/generator.ts — DSA Art. 17 justification generation
import { runAiCompletion } from '../ai/index.js';
import type { ModerationResult, AiOptions, AiSeverity } from '../ai/types.js';
import { buildJustificationPrompt, buildJustificationSchema } from './prompt.js';
import type {
  ComplianceJustification,
  ComplianceAction,
  PolicyBasis,
  GenerateJustificationOptions,
} from './types.js';

/**
 * Stands in for `facts.quote` when neither the model nor the word lists could
 * point at anything — a decision taken on something this library never saw.
 * The field stays populated so the record has no empty holes in it.
 */
const NO_EXCERPT = '[content]';

function normalizePolicy(basis: PolicyBasis | string): PolicyBasis {
  if (typeof basis === 'string') {
    return { name: basis };
  }
  return basis;
}

function detectLanguage(text: string, hint?: string): string {
  if (hint) return hint;
  const germanWords = /\b(der|die|das|und|ist|zu|von|ein|in|für|mit|nicht|auch|sich)\b/gi;
  const germanMatch = (text.match(germanWords) || []).length;
  return germanMatch / (text.split(/\s+/).length || 1) > 0.15 ? 'de' : 'en';
}

function buildDefaultReason(
  action: ComplianceAction,
  language: string,
): string {
  const translations = {
    en: {
      CONTENT_REMOVED: 'Your content was removed for violating community standards.',
      CONTENT_DEMOTION: 'Your content visibility was restricted.',
      ACCOUNT_SUSPENSION: 'Your account has been suspended.',
      ACCOUNT_TERMINATION: 'Your account has been terminated.',
      FEATURE_RESTRICTION: 'Some features have been restricted on your account.',
    },
    de: {
      CONTENT_REMOVED: 'Ihr Inhalt wurde entfernt, da er gegen die Gemeinschaftsstandards verstößt.',
      CONTENT_DEMOTION: 'Die Sichtbarkeit Ihres Inhalts wurde eingeschränkt.',
      ACCOUNT_SUSPENSION: 'Ihr Konto wurde gesperrt.',
      ACCOUNT_TERMINATION: 'Ihr Konto wurde beendet.',
      FEATURE_RESTRICTION: 'Einige Funktionen auf Ihrem Konto wurden eingeschränkt.',
    },
  } as const satisfies Record<string, Record<ComplianceAction, string>>;

  return translations[language as keyof typeof translations]?.[action] ?? translations.en[action];
}

/**
 * The assessment when no model was asked.
 *
 * It is deliberately thinner than the model's: a word list knows that a term
 * matched, never what the sentence was doing with it. Claiming more than that
 * in a notice someone may contest would be inventing grounds — so this says
 * exactly what was established and, where it applies, admits what was not.
 */
function buildDefaultAssessment(
  result: ModerationResult,
  language: string,
): string {
  const severity = result.ai.status === 'ok' ? result.ai.severity : 'none';

  const translations = {
    en: {
      graded: {
        none: 'No weighting was assigned to this case.',
        low: 'The wording is crude rather than aimed at anyone, and is weighted accordingly.',
        medium: 'The wording is clearly insulting and is weighted as a substantive violation.',
        high: 'The wording is targeted abuse and weighs heavily.',
        critical: 'The wording falls into the most serious category the review distinguishes.',
      },
      listOnly:
        'The excerpt matched a term held in the word list for the languages checked. ' +
        'That establishes which words were used; it does not establish what the ' +
        'sentence was doing with them, and no such finding is claimed here.',
      byModel: 'Categories found: {categories}. Reported confidence: {confidence}%.',
      lowConfidence:
        'The confidence in this classification is limited, and the case should be read ' +
        'as an uncertain one.',
      contest: 'If you read the passage differently, that is what the appeal is for.',
    },
    de: {
      graded: {
        none: 'Diesem Fall wurde keine Gewichtung zugeordnet.',
        low: 'Die Formulierung ist derb, aber auf niemanden gerichtet, und wird entsprechend gewichtet.',
        medium: 'Die Formulierung ist eindeutig beleidigend und wiegt als eigenständiger Verstoß.',
        high: 'Die Formulierung ist gezielte Herabwürdigung und wiegt schwer.',
        critical: 'Die Formulierung fällt in die schwerste Kategorie, die die Prüfung unterscheidet.',
      },
      listOnly:
        'Die zitierte Stelle entspricht einem Begriff aus der Wortliste der geprüften ' +
        'Sprachen. Damit steht fest, welche Wörter gefallen sind — nicht, was der Satz ' +
        'mit ihnen tut. Eine solche Feststellung wird hier auch nicht behauptet.',
      byModel: 'Gefundene Kategorien: {categories}. Angegebene Sicherheit: {confidence}%.',
      lowConfidence:
        'Die Sicherheit dieser Einordnung ist begrenzt; der Fall ist als unsicher zu lesen.',
      contest: 'Wer die Stelle anders liest, kann genau dafür Widerspruch einlegen.',
    },
  } as const satisfies Record<string, Record<string, unknown>>;

  const t = translations[language as keyof typeof translations] ?? translations.en;
  const sentences: string[] = [];

  // 'none' is the absence of a grading, not a grading of zero — saying so out
  // loud only helps when nothing else explains why there is none.
  if (severity !== 'none') sentences.push(t.graded[severity]);

  if (result.ai.status === 'ok' && result.ai.categories.length > 0) {
    sentences.push(
      t.byModel
        .replace('{categories}', result.ai.categories.join(', '))
        .replace('{confidence}', String(Math.round(result.ai.confidence * 100))),
    );
    if (result.ai.confidence > 0 && result.ai.confidence < 0.6) {
      sentences.push(t.lowConfidence);
    }
  } else if (result.matchedList) {
    sentences.push(t.listOnly);
  }

  if (sentences.length === 0) sentences.push(t.graded.none);

  sentences.push(t.contest);
  return sentences.join(' ');
}


/**
 * Generate a DSA Art. 17 compliant justification for a moderation action.
 *
 * If AI is enabled, the reason and facts summary will be generated by the model
 * from the pre-determined facts. If disabled or fails, falls back to templates.
 * Never throws — a failed KI should not prevent a legal notification.
 */
export async function generateJustification(
  text: string,
  result: ModerationResult,
  options: GenerateJustificationOptions = {},
): Promise<ComplianceJustification> {
  const language = options.language || detectLanguage(text);
  const action = options.action || 'CONTENT_REMOVED';
  const policyBases = (options.policyBases || ['Community Guidelines']).map(normalizePolicy);

  // A verdict that errored or was refused carries a severity of 'none' already,
  // but reading it off `status` says why it is 'none' rather than leaving the
  // grading to look like a considered finding of harmlessness.
  const severity: AiSeverity = result.ai.status === 'ok' ? result.ai.severity : 'none';

  // The template wording is the floor, not the fallback of last resort: it is a
  // complete justification on its own, and it is what stays if the model is
  // slow, refuses, or was never configured.
  let reason = buildDefaultReason(action, language);
  let assessment = buildDefaultAssessment(result, language);

  // No `ai` option at all means no model is contacted — same rule as
  // `moderateText`. The network call is opted into, never inherited.
  const ai = options.ai;
  if (ai && ai.enabled !== false) {
    const aiOptions: AiOptions = {
      effort: 'low',
      // Two or three graded sentences, not a label — and on a thinking model
      // the reasoning is drawn from the same budget.
      maxTokens: 2048,
      onError: 'return',
      ...(ai.provider !== undefined ? { provider: ai.provider } : {}),
      ...(ai.apiKey !== undefined ? { apiKey: ai.apiKey } : {}),
      ...(ai.model !== undefined ? { model: ai.model } : {}),
      ...(ai.complete !== undefined ? { complete: ai.complete } : {}),
    };

    const response = await runAiCompletion(
      {
        system: buildJustificationPrompt({
          action,
          categories: result.ai.categories,
          language,
          severity,
          ...(ai.extraInstructions !== undefined
            ? { extraInstructions: ai.extraInstructions }
            : {}),
        }),
        // The facts, handed over as data. The model rewrites them; it never
        // gets to decide what they are.
        text: [
          `Action: ${action}`,
          `Categories: ${result.ai.categories.join(', ') || '(none)'}`,
          `Severity: ${severity}`,
          `Policy bases: ${policyBases
            .map((p) => `${p.name}${p.section ? ' ' + p.section : ''}`)
            .join(', ')}`,
          `Quote: ${JSON.stringify(result.ai.quote)}`,
          `Confidence: ${Math.round(result.ai.confidence * 100)}%`,
          `Duration: ${options.duration || 'permanent'}`,
          // Without this the model has no way to tell a graded judgement from a
          // bare string match, and would write the same confident paragraph for
          // both.
          `How this was found: ${
            result.ai.status === 'ok'
              ? 'a model read the whole sentence and graded it'
              : 'only a word list matched — no model judged the sentence'
          }`,
        ].join('\n'),
        schema: buildJustificationSchema(),
      },
      aiOptions,
    );

    if (response) {
      try {
        const parsed: unknown = JSON.parse(response.json);
        const value = (parsed ?? {}) as Record<string, unknown>;
        if (typeof value['reason'] === 'string' && value['reason'].trim() !== '') {
          reason = value['reason'];
        }
        if (typeof value['assessment'] === 'string' && value['assessment'].trim() !== '') {
          assessment = value['assessment'];
        }
      } catch {
        // Unparseable wording is not a reason to withhold the notification.
      }
    }
  }

  const timestamp = new Date().toISOString();

  return {
    action,
    reason,
    assessment,
    policyBases,
    facts: {
      // The model's own excerpt when there is one, otherwise the words the
      // lists actually matched — whichever it was, it is what the decision
      // rests on and the notice has to be able to name it.
      quote:
        result.ai.quote ||
        result.segments
          .filter((s) => s.isProfane)
          .map((s) => s.text)
          .join(', ') ||
        NO_EXCERPT,
      categories: result.ai.categories,
      severity,
      confidence: result.ai.confidence,
      automatedDetection: result.ai.status === 'ok' || result.matchedList,
      humanReview: false,
    },
    timestamp,
    duration: options.duration || 'permanent',
    language,
    appealUrl: options.appealUrl,
    additionalNotes: options.additionalNotes,
  };
}

export function exportJustification(justification: ComplianceJustification): string {
  return JSON.stringify(justification, null, 2);
}

export function formatJustificationAsText(justification: ComplianceJustification): string {
  const translations = {
    en: {
      action: 'Action taken:',
      reason: 'Reason:',
      policies: 'Policy bases:',
      assessment: 'Assessment:',
      categories: 'Categories:',
      severity: 'Severity:',
      confidence: 'Confidence:',
      automated: 'Automated detection:',
      humanReview: 'Human review:',
      facts: 'Facts:',
      timestamp: 'Date:',
      duration: 'Duration:',
      appeal: 'To appeal:',
      yes: 'Yes',
      no: 'No',
    },
    de: {
      action: 'Getroffene Maßnahme:',
      reason: 'Grund:',
      policies: 'Grundlagen:',
      assessment: 'Bewertung:',
      categories: 'Kategorien:',
      severity: 'Schweregrad:',
      confidence: 'Sicherheit:',
      automated: 'Automatische Erkennung:',
      humanReview: 'Menschliche Überprüfung:',
      facts: 'Tatsachen:',
      timestamp: 'Datum:',
      duration: 'Dauer:',
      appeal: 'Um zu protestieren:',
      yes: 'Ja',
      no: 'Nein',
    },
  } as const satisfies Record<string, Record<string, string>>;

  const t = translations[justification.language as keyof typeof translations] ?? translations.en;
  const facts = justification.facts;

  const lines: string[] = [
    `${t.action} ${justification.action}`,
    `${t.reason} ${justification.reason}`,
  ];

  if (justification.assessment) {
    lines.push(`${t.assessment} ${justification.assessment}`);
  }

  // Art. 17 wants the facts the decision rests on, and the excerpt *is* the
  // fact. A notice that says "you broke the rules" without saying which words
  // is exactly the notice the article was written against.
  if (facts.quote && facts.quote !== NO_EXCERPT) {
    lines.push(`${t.facts} ${JSON.stringify(facts.quote)}`);
  }

  lines.push(
    `${t.policies} ${justification.policyBases
      .map((p) => `${p.name}${p.section ? ' ' + p.section : ''}`)
      .join(', ')}`,
  );

  // Categories and confidence come from a model. When none was asked, printing
  // "(none)" and "0%" reads as an uncertain decision rather than an unasked
  // question — so those lines are simply absent instead.
  if (facts.categories.length > 0) {
    lines.push(`${t.categories} ${facts.categories.join(', ')}`);
  }
  if (facts.severity !== 'none') {
    lines.push(`${t.severity} ${facts.severity}`);
  }
  if (facts.confidence > 0) {
    lines.push(`${t.confidence} ${Math.round(facts.confidence * 100)}%`);
  }

  lines.push(
    `${t.automated} ${facts.automatedDetection ? t.yes : t.no}`,
    `${t.humanReview} ${facts.humanReview ? t.yes : t.no}`,
    `${t.timestamp} ${new Date(justification.timestamp).toLocaleString(justification.language)}`,
    `${t.duration} ${justification.duration}`,
  );

  if (justification.appealUrl) {
    lines.push(`${t.appeal} ${justification.appealUrl}`);
  }

  if (justification.additionalNotes) {
    lines.push(`\n${justification.additionalNotes}`);
  }

  return lines.join('\n');
}
