import { useEffect, useState } from 'react';
import {
  ButtonGroup,
  Button,
  Tag,
  Spinner,
  NonIdealState,
  Section,
  Intent,
} from '@blueprintjs/core';
import { useQuery } from '@tanstack/react-query';
import { getAddressClusters, type CompanyRecord } from '../../api/corporate';
import { InlinePagination } from './InlinePagination';

interface AddressClustersProps {
  onCompanyClick?: (id: string) => void;
  onPANClick?: (pan: string) => void;
}

const THRESHOLD_OPTIONS = [
  { label: '5+', value: 5 },
  { label: '10+', value: 10 },
  { label: '20+', value: 20 },
] as const;

function getCountIntent(count: number): Intent {
  if (count >= 20) return Intent.DANGER;
  if (count >= 10) return Intent.WARNING;
  return Intent.PRIMARY;
}

function getIrdIntent(status: string | null | undefined): Intent {
  if (!status) return Intent.NONE;
  const lower = status.toLowerCase();
  if (lower.includes('non-filer') || lower.includes('cancelled')) return Intent.DANGER;
  if (lower.includes('active') || lower === 'a' || lower === 'filer') return Intent.SUCCESS;
  return Intent.WARNING;
}

export function AddressClusters({ onCompanyClick, onPANClick }: AddressClustersProps) {
  const [minCompanies, setMinCompanies] = useState(5);
  const [clusterPage, setClusterPage] = useState(1);
  const [clusterPageSize, setClusterPageSize] = useState(20);

  const { data: clusters, isLoading, isError, error } = useQuery({
    queryKey: ['address-clusters', minCompanies],
    queryFn: () => getAddressClusters(minCompanies),
  });

  const sortedClusters = clusters
    ? [...clusters].sort((a, b) => b.count - a.count)
    : [];
  const totalClusterPages = Math.max(1, Math.ceil(sortedClusters.length / clusterPageSize));
  const currentClusterPage = Math.min(clusterPage, totalClusterPages);
  const pagedClusters = sortedClusters.slice(
    (currentClusterPage - 1) * clusterPageSize,
    currentClusterPage * clusterPageSize,
  );

  useEffect(() => {
    setClusterPage(1);
  }, [minCompanies, clusterPageSize]);

  useEffect(() => {
    if (clusterPage > totalClusterPages) {
      setClusterPage(totalClusterPages);
    }
  }, [clusterPage, totalClusterPages]);

  return (
    <div className="bp6-dark flex flex-col gap-4 p-4 bg-bp-bg min-h-full">
      {/* Header */}
      <div className="flex items-center justify-between rounded-lg px-5 py-4 bg-bp-card border border-bp-border">
        <div className="flex items-center gap-4">
          <h2 className="m-0 text-lg font-semibold text-bp-text">
            Address Cluster Analysis
          </h2>
          {sortedClusters.length > 0 && (
            <Tag minimal intent={Intent.PRIMARY} large>
              {sortedClusters.length} cluster{sortedClusters.length !== 1 ? 's' : ''}
            </Tag>
          )}
        </div>

        <div className="flex items-center gap-3">
          <span className="text-sm text-bp-text-secondary">
            Min. companies:
          </span>
          <ButtonGroup>
            {THRESHOLD_OPTIONS.map((opt) => (
              <Button
                key={opt.value}
                text={opt.label}
                active={minCompanies === opt.value}
                intent={minCompanies === opt.value ? Intent.PRIMARY : Intent.NONE}
                onClick={() => setMinCompanies(opt.value)}
                small
              />
            ))}
          </ButtonGroup>
        </div>
      </div>

      {/* Content */}
      {isLoading && (
        <div className="flex items-center justify-center py-20">
          <Spinner intent={Intent.PRIMARY} size={48} />
        </div>
      )}

      {isError && (
        <NonIdealState
          icon="error"
          title="Failed to load clusters"
          description={error instanceof Error ? error.message : 'An unexpected error occurred.'}
        />
      )}

      {!isLoading && !isError && sortedClusters.length === 0 && (
        <NonIdealState
          icon="search"
          title="No address clusters found"
          description={`No addresses with ${minCompanies} or more registered companies were found.`}
        />
      )}

      {!isLoading && !isError && sortedClusters.length > 0 && (
        <div className="flex flex-col gap-2">
          {pagedClusters.map((cluster) => (
            <ClusterSection
              key={cluster.address}
              address={cluster.address}
              count={cluster.count}
              companies={cluster.companies}
              onCompanyClick={onCompanyClick}
              onPANClick={onPANClick}
            />
          ))}
          <InlinePagination
            page={currentClusterPage}
            pageSize={clusterPageSize}
            total={sortedClusters.length}
            onPageChange={setClusterPage}
            onPageSizeChange={setClusterPageSize}
            pageSizeOptions={[10, 20, 50]}
          />
        </div>
      )}
    </div>
  );
}

interface ClusterSectionProps {
  address: string;
  count: number;
  companies: CompanyRecord[];
  onCompanyClick?: (id: string) => void;
  onPANClick?: (pan: string) => void;
}

function ClusterSection({ address, count, companies, onCompanyClick, onPANClick }: ClusterSectionProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [companyPage, setCompanyPage] = useState(1);
  const [companyPageSize, setCompanyPageSize] = useState(20);
  const intent = getCountIntent(count);
  const totalCompanyPages = Math.max(1, Math.ceil(companies.length / companyPageSize));
  const currentCompanyPage = Math.min(companyPage, totalCompanyPages);
  const pagedCompanies = companies.slice(
    (currentCompanyPage - 1) * companyPageSize,
    currentCompanyPage * companyPageSize,
  );

  useEffect(() => {
    setCompanyPage(1);
  }, [companyPageSize, isOpen]);

  useEffect(() => {
    if (companyPage > totalCompanyPages) {
      setCompanyPage(totalCompanyPages);
    }
  }, [companyPage, totalCompanyPages]);

  return (
    <div className="rounded-lg overflow-hidden bg-bp-card border border-bp-border">
      <Section
        title={
          <div className="flex items-center gap-3">
            <span className="text-bp-text">{address}</span>
            <Tag intent={intent} round minimal>
              {count} {count === 1 ? 'company' : 'companies'}
            </Tag>
          </div>
        }
        collapsible
        collapseProps={{
          isOpen,
          onToggle: () => setIsOpen((prev) => !prev),
        }}
        compact
        className="cluster-section"
      >
        <div className="flex flex-col bg-bp-surface">
          {/* Column headers */}
          <div
            className="grid px-4 py-2 text-xs font-medium uppercase tracking-wider text-bp-text-secondary border-b border-bp-border"
            style={{ gridTemplateColumns: '2fr 1fr 1fr 1fr' }}
          >
            <span>Company Name</span>
            <span>PAN</span>
            <span>IRD Status</span>
            <span>District</span>
          </div>

          {isOpen && pagedCompanies.map((company) => (
            <div
              key={company.id}
              className="grid items-center px-4 py-2 transition-colors border-b border-bp-border hover:bg-bp-hover"
              style={{ gridTemplateColumns: '2fr 1fr 1fr 1fr' }}
            >
              {/* Company name */}
              <span
                className={`truncate text-sm ${onCompanyClick ? 'text-bp-primary-hover cursor-pointer' : 'text-bp-text cursor-default'}`}
                onClick={() => onCompanyClick?.(String(company.id))}
                title={company.name_english || undefined}
              >
                {company.name_english || company.name_nepali || '(unnamed)'}
              </span>

              {/* PAN */}
              <span>
                {company.pan ? (
                  <Tag
                    minimal
                    interactive={!!onPANClick}
                    intent={Intent.NONE}
                    onClick={() => onPANClick?.(company.pan!)}
                    className={onPANClick ? 'cursor-pointer' : 'cursor-default'}
                  >
                    {company.pan}
                  </Tag>
                ) : (
                  <span className="text-xs text-bp-text-secondary">--</span>
                )}
              </span>

              {/* IRD Status */}
              <span>
                {company.ird_status ? (
                  <Tag minimal intent={getIrdIntent(company.ird_status)} className="truncate max-w-[140px]">
                    {company.ird_status}
                  </Tag>
                ) : company.ird_enriched ? (
                  <span className="text-xs text-bp-text-secondary">N/A</span>
                ) : (
                  <span className="text-xs text-bp-text-secondary">--</span>
                )}
              </span>

              {/* District */}
              <span className="truncate text-sm text-bp-text">
                {company.district || '--'}
              </span>
            </div>
          ))}
          {isOpen && (
            <div className="px-4">
              <InlinePagination
                page={currentCompanyPage}
                pageSize={companyPageSize}
                total={companies.length}
                onPageChange={setCompanyPage}
                onPageSizeChange={setCompanyPageSize}
                pageSizeOptions={[10, 20, 50]}
              />
            </div>
          )}
        </div>
      </Section>
    </div>
  );
}
