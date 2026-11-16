'use client';

import { Compass } from 'lucide-react';

export default function PageQuickStart({
  title = 'Quick Start',
  description,
  steps,
  note,
}: {
  title?: string;
  description: string;
  steps: string[];
  note?: string;
}) {
  return (
    <div className="page-quick-start">
      <div className="page-quick-start-header">
        <div className="page-quick-start-icon">
          <Compass size={16} />
        </div>
        <div>
          <div className="page-quick-start-title">{title}</div>
          <div className="page-quick-start-copy">{description}</div>
        </div>
      </div>

      <div className="page-quick-start-steps">
        {steps.map((step, index) => (
          <div key={`${title}-${index}`} className="page-quick-start-step">
            <span className="page-quick-start-index">{index + 1}</span>
            <span>{step}</span>
          </div>
        ))}
      </div>

      {note ? <div className="page-quick-start-note">{note}</div> : null}
    </div>
  );
}
