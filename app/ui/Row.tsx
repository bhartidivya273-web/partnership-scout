"use client";

import { CATEGORY_CHIP_LABELS, COPY } from "@/lib/copy";
import type { Decision } from "@/lib/decisions";
import { closesText, formatDateTime, formatInt, isClosingSoon, launchedText, oneDecimal, safeHttpUrl, twitterUrl } from "@/lib/format";
import type { ResultItem } from "@/lib/result";
import { recommendedAction } from "@/lib/workspace";
import { CopyButton, FitBadge } from "./bits";

const RESPONSIVE_TEXT = { high: "very active", moderate: "replying", low: "some activity", none: "no replies yet" } as const;

export function StatusChip({ decision }: { decision?: Decision }) {
  if (!decision || decision.status === "none") return null;
  return <span className={`badge status-${decision.status}`}>{decision.status === "shortlisted" ? "Shortlisted" : "Contacted"}</span>;
}

export function FounderLine({ item, full = false }: { item: ResultItem; full?: boolean }) {
  const hidden = item.founder.hiddenCount;
  if (item.founder.founderSource === "none") {
    return (
      <span className="founder" title={COPY.FOUNDER_TIP_NONE}>
        {COPY.FOUNDER_NONE}
      </span>
    );
  }
  const makers = full ? item.founder.makers : item.founder.makers.slice(0, 1);
  return (
    <span className="founder" title={hidden > 0 ? `${hidden} of the makers are hidden by Product Hunt.` : undefined}>
      Founder:{" "}
      {makers.map((m, i) => {
        const profile = safeHttpUrl(m.profileUrl);
        return (
          <span key={`${m.username ?? m.name}-${i}`}>
            {i > 0 && ", "}
            {profile ? (
              <a href={profile} target="_blank" rel="noopener noreferrer">
                {m.name}
              </a>
            ) : (
              m.name
            )}
            {m.followersCount ? <span className="muted"> ({formatInt(m.followersCount)} followers)</span> : null}
          </span>
        );
      })}
      {!full && item.founder.totalMakers > 1 ? ` +${item.founder.totalMakers - 1} more` : null}
    </span>
  );
}

export function ExternalLinks({ item }: { item: ResultItem }) {
  const site = safeHttpUrl(item.websiteUrl);
  return (
    <span className="links">
      <a href={item.productHuntUrl} target="_blank" rel="noopener noreferrer">
        {COPY.LINK_PH}
      </a>
      {site && (
        <a href={site} target="_blank" rel="noopener noreferrer">
          {COPY.LINK_SITE}
        </a>
      )}
    </span>
  );
}

export function MakerLinks({ item }: { item: ResultItem }) {
  return (
    <>
      {item.founder.makers.map((m, i) => {
        const tw = twitterUrl(m.twitterUsername);
        const site = safeHttpUrl(m.websiteUrl);
        if (!tw && !site) return null;
        return (
          <span key={i} className="links">
            {tw && (
              <a href={tw} target="_blank" rel="noopener noreferrer">
                {m.name} on X
              </a>
            )}
            {site && (
              <a href={site} target="_blank" rel="noopener noreferrer">
                {m.name}&apos;s site
              </a>
            )}
          </span>
        );
      })}
    </>
  );
}

export function Row(props: {
  item: ResultItem;
  decision?: Decision;
  onOpen: (id: string) => void;
  onToggleShortlist: (item: ResultItem) => void;
}) {
  const { item, decision, onOpen, onToggleShortlist } = props;
  const closing = isClosingSoon(item.daysLeft);
  const action = recommendedAction(item);
  const shortlisted = decision?.status === "shortlisted";
  return (
    <li className={`row${closing ? " row-closing" : ""}`}>
      <div className="row-head">
        <span className="rank" title="Rank by priority score">
          #{item.rank}
        </span>
        <h3 className="name">
          <button type="button" className="linkish" onClick={() => onOpen(item.id)}>
            {item.name}
          </button>
        </h3>
        <FitBadge fit={item.fit} />
        {closing && <span className="badge closing">{COPY.BADGE_CLOSING}</span>}
        <StatusChip decision={decision} />
        <span className="score" title="Priority score: votes, maker comments, momentum, relevance, time left and evidence. Open the details for the breakdown.">
          <strong>{oneDecimal(item.priority.total)}</strong>
          <span className="muted"> / 100</span>
        </span>
      </div>

      <p className="tagline">{item.tagline.trim() || COPY.NO_DESCRIPTION}</p>

      <p className="meta">
        <FounderLine item={item} />
        {item.categories.map((c) => (
          <span key={c} className="tag">
            {CATEGORY_CHIP_LABELS[c]}
          </span>
        ))}
        {item.categorySource === "topic" && <span className="tag tag-note">{COPY.CAT_SOURCE_TOPIC}</span>}
        <span className="tag" title="How many of the 5 evidence checks are met. Open the details to see which.">
          Evidence {item.evidence.count}/{item.evidence.total}
        </span>
      </p>

      {item.relevance && (
        <p className="why-fit">
          <strong>Why it may fit:</strong> {item.relevance}
        </p>
      )}

      <dl className="stats">
        <div title={COPY.METRIC_VOTES_TIP}>
          <dt>{COPY.METRIC_VOTES}</dt>
          <dd>{formatInt(item.upvotes)}</dd>
        </div>
        <div title={`${COPY.METRIC_MAKER_TIP} ${item.responsiveness.note}`}>
          <dt>{COPY.METRIC_MAKER}</dt>
          <dd>
            {formatInt(item.makerComments)} <span className="resp muted">{RESPONSIVE_TEXT[item.responsiveness.level]}</span>
          </dd>
        </div>
        <div title={formatDateTime(item.launchedAt)}>
          <dt>Launched</dt>
          <dd>{launchedText(item.daysSinceLaunch).replace("Launched ", "")}</dd>
        </div>
        <div>
          <dt>Outreach window</dt>
          <dd className={closing ? "warn" : undefined}>{closesText(item.daysLeft)}</dd>
        </div>
      </dl>

      <p className={`action action-${action.tone}`}>
        <strong>Next step:</strong> {action.label}
      </p>

      <div className="row-foot">
        <span className="row-buttons">
          <button type="button" className="secondary small" onClick={() => onOpen(item.id)}>
            Open details
          </button>
          <button type="button" className={`secondary small${shortlisted ? " on" : ""}`} aria-pressed={shortlisted} onClick={() => onToggleShortlist(item)}>
            {shortlisted ? "★ Shortlisted" : "☆ Shortlist"}
          </button>
          <CopyButton text={item.outreach.message} label="Copy message" />
        </span>
        <ExternalLinks item={item} />
      </div>
    </li>
  );
}
