import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Job, JobStatus } from '../types';
import { RouteStrip, Timeline } from './JobProgress';

function job(status: JobStatus, reached: JobStatus[]): Job {
  return {
    status,
    timeline: reached.map((to, i) => ({
      from: i === 0 ? null : reached[i - 1],
      to,
      note: to === 'ACCEPTED' ? 'Accepted by Ravi' : null,
      at: new Date(Date.UTC(2026, 9, 29, 4, i)).toISOString(),
    })),
  } as unknown as Job;
}

describe('RouteStrip', () => {
  it('marks the current stop and fills the ones behind it', () => {
    render(<RouteStrip job={job('ARRIVED', ['CREATED', 'MATCHED', 'ACCEPTED', 'EN_ROUTE', 'ARRIVED'])} />);
    const current = screen.getByText('Arrived').previousElementSibling;
    expect(current).toHaveAttribute('aria-current', 'step');
    expect(screen.getAllByText('✓')).toHaveLength(2);
  });

  it('ticks every stop once completed', () => {
    render(
      <RouteStrip
        job={job('COMPLETED', ['CREATED', 'MATCHED', 'ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS', 'COMPLETED'])}
      />
    );
    expect(screen.getAllByText('✓')).toHaveLength(5);
  });
});

describe('Timeline', () => {
  it('lists status changes newest first with their notes', () => {
    render(<Timeline job={job('ACCEPTED', ['CREATED', 'MATCHED', 'ACCEPTED'])} role="CUSTOMER" />);
    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Assigned');
    expect(items[0]).toHaveTextContent('Accepted by Ravi');
    expect(items[2]).toHaveTextContent('Finding a technician');
  });
});
