import { useCallback, useMemo, useState } from "react";
import {
  Card,
  Icon,
  InputGroup,
  NonIdealState,
  Tag,
  Tree,
  type TreeNodeInfo,
} from "@blueprintjs/core";
import { useQuery } from "@tanstack/react-query";
import {
  getSharedDirectors,
  searchCompanies,
  type CompanyRecord,
  type DirectorRecord,
} from "../../api/corporate";

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

interface DirectorNetworkProps {
  selectedCompanyId?: string;
  onCompanyClick?: (id: string) => void;
  onPANClick?: (pan: string) => void;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Simple debounce hook-friendly timeout id holder */
function useDebounce(delay: number) {
  const [timer, setTimer] = useState<ReturnType<typeof setTimeout> | null>(
    null
  );
  const debounce = useCallback(
    (fn: () => void) => {
      if (timer) clearTimeout(timer);
      setTimer(setTimeout(fn, delay));
    },
    [delay, timer]
  );
  return debounce;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function DirectorNetwork({
  selectedCompanyId: externalCompanyId,
  onCompanyClick,
  onPANClick,
}: DirectorNetworkProps) {
  /* ---- local state ---- */
  const [internalCompanyId, setInternalCompanyId] = useState<
    string | undefined
  >(undefined);
  const selectedCompanyId = externalCompanyId ?? internalCompanyId;

  const [searchText, setSearchText] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());

  const debounce = useDebounce(300);

  /* ---- search query ---- */
  const {
    data: searchResults,
    isFetching: isSearching,
  } = useQuery({
    queryKey: ["directorNetwork-search", debouncedQuery],
    queryFn: () =>
      searchCompanies({ q: debouncedQuery, limit: 8 }),
    enabled: debouncedQuery.length >= 2,
    staleTime: 30_000,
  });

  /* ---- shared directors query ---- */
  const {
    data: directors,
    isLoading: isLoadingDirectors,
  } = useQuery({
    queryKey: ["directorNetwork-directors", selectedCompanyId],
    queryFn: () => getSharedDirectors(selectedCompanyId!),
    enabled: !!selectedCompanyId,
    staleTime: 60_000,
  });

  /* ---- find the selected company name from directors data ---- */
  const selectedCompanyName = useMemo(() => {
    if (!directors || directors.length === 0) return "Selected Company";
    const first = directors.find(
      (d: DirectorRecord) => d.company_id === selectedCompanyId
    );
    return first?.company_name ?? "Selected Company";
  }, [directors, selectedCompanyId]);

  /* ---- build tree ---- */
  const treeNodes: TreeNodeInfo[] = useMemo(() => {
    if (!selectedCompanyId || !directors) return [];

    // Group directors by unique person (name_en + citizenship_no)
    const directorMap = new Map<
      string,
      {
        director: DirectorRecord;
        otherCompanies: DirectorRecord[];
      }
    >();

    for (const d of directors) {
      const key = d.citizenship_no
        ? `cit-${d.citizenship_no}`
        : `name-${d.name_en}`;

      if (!directorMap.has(key)) {
        // Find the record for this director in the selected company
        const selfRecord = directors.find(
          (r: DirectorRecord) =>
            r.company_id === selectedCompanyId &&
            ((r.citizenship_no && r.citizenship_no === d.citizenship_no) ||
              r.name_en === d.name_en)
        );
        directorMap.set(key, {
          director: selfRecord ?? d,
          otherCompanies: [],
        });
      }

      // Add other-company records
      if (d.company_id !== selectedCompanyId) {
        directorMap.get(key)!.otherCompanies.push(d);
      }
    }

    // Build child nodes for each director
    const directorNodes: TreeNodeInfo[] = Array.from(
      directorMap.values()
    ).map(({ director, otherCompanies }) => {
      const dirNodeId = `director-${director.id}`;
      const isExpanded = expandedNodes.has(dirNodeId);

      const companyChildren: TreeNodeInfo[] = otherCompanies.map((oc) => ({
        id: `company-${oc.company_id}-via-${director.id}`,
        label: (
          <span
            className="cursor-pointer hover:underline text-bp-text"
            onClick={(e) => {
              e.stopPropagation();
              if (oc.company_id) {
                if (onCompanyClick) onCompanyClick(oc.company_id);
                else setInternalCompanyId(oc.company_id);
              }
            }}
          >
            {oc.company_name}
          </span>
        ),
        icon: <Icon icon="office" size={14} className="text-bp-text-muted" />,
        secondaryLabel: (
          <Tag
            minimal
            intent="primary"
            className="text-[10px]"
          >
            Shared Director
          </Tag>
        ),
      }));

      return {
        id: dirNodeId,
        label: (
          <span className="text-bp-text">
            {director.name_en ?? director.name_np ?? "Unknown"}{" "}
            <span className="text-bp-text-secondary text-xs">
              ({director.role ?? "Director"})
            </span>
          </span>
        ),
        icon: <Icon icon="person" size={14} className="text-bp-text-secondary" />,
        secondaryLabel: director.role ? (
          <Tag minimal intent="none" className="text-[10px] text-bp-text-muted">
            {director.role}
          </Tag>
        ) : undefined,
        isExpanded,
        childNodes: companyChildren.length > 0 ? companyChildren : undefined,
        hasCaret: companyChildren.length > 0,
      };
    });

    // Root node: the selected company
    const rootId = `root-${selectedCompanyId}`;
    const rootNode: TreeNodeInfo = {
      id: rootId,
      label: (
        <span className="font-semibold text-bp-text">
          {selectedCompanyName}
        </span>
      ),
      icon: <Icon icon="office" size={16} className="text-bp-primary-hover" />,
      isExpanded: expandedNodes.has(rootId) || expandedNodes.size === 0,
      childNodes: directorNodes,
      hasCaret: true,
    };

    return [rootNode];
  }, [
    selectedCompanyId,
    directors,
    expandedNodes,
    selectedCompanyName,
    onCompanyClick,
  ]);

  /* ---- tree expand/collapse handler ---- */
  const handleNodeExpand = useCallback((node: TreeNodeInfo) => {
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      next.add(String(node.id));
      return next;
    });
  }, []);

  const handleNodeCollapse = useCallback((node: TreeNodeInfo) => {
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      next.delete(String(node.id));
      return next;
    });
  }, []);

  /* ---- tree node click ---- */
  const handleNodeClick = useCallback(
    (node: TreeNodeInfo) => {
      const nodeId = String(node.id);

      // If clicking a company node, navigate to it
      if (nodeId.startsWith("company-")) {
        const companyId = nodeId.replace("company-", "").split("-via-")[0];
        if (onCompanyClick) onCompanyClick(companyId);
        else setInternalCompanyId(companyId);
        return;
      }

      // If clicking the root node, fire onCompanyClick with current
      if (nodeId.startsWith("root-") && onPANClick) {
        // Find PAN for the selected company from directors data
        const rec = directors?.find(
          (d: DirectorRecord) => d.company_id === selectedCompanyId && d.pan
        );
        if (rec?.pan) onPANClick(rec.pan);
        return;
      }

      // Toggle expand for director nodes
      if (expandedNodes.has(nodeId)) {
        handleNodeCollapse(node);
      } else {
        handleNodeExpand(node);
      }
    },
    [
      onCompanyClick,
      onPANClick,
      directors,
      selectedCompanyId,
      expandedNodes,
      handleNodeCollapse,
      handleNodeExpand,
    ]
  );

  /* ---- search input handler ---- */
  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value;
      setSearchText(val);
      debounce(() => setDebouncedQuery(val.trim()));
    },
    [debounce]
  );

  /* ---- select a company from search ---- */
  const handleSelectCompany = useCallback(
    (company: CompanyRecord) => {
      if (onCompanyClick) {
        onCompanyClick(company.id);
      } else {
        setInternalCompanyId(company.id);
      }
      setSearchText("");
      setDebouncedQuery("");
      setExpandedNodes(new Set());
    },
    [onCompanyClick]
  );

  /* ---- render ---- */
  return (
    <div
      className="bp6-dark flex flex-col h-full w-full overflow-hidden rounded-lg bg-bp-bg text-bp-text border-bp-border"
    >
      {/* Search bar */}
      <div
        className="p-3 border-b border-bp-border bg-bp-card"
      >
        <InputGroup
          leftIcon="search"
          placeholder="Search companies to explore..."
          value={searchText}
          onChange={handleSearchChange}
          large={false}
          className="bp6-dark bg-bp-bg"
        />

        {/* Search results dropdown */}
        {debouncedQuery.length >= 2 && (
          <div
            className="mt-2 flex flex-col gap-1 max-h-60 overflow-y-auto"
            style={{ scrollbarWidth: "thin" }}
          >
            {isSearching && (
              <div className="text-xs py-2 text-center text-bp-text-secondary">
                Searching...
              </div>
            )}
            {searchResults?.items?.map((company: CompanyRecord) => (
              <Card
                key={company.id}
                interactive
                className="bp6-dark cursor-pointer bg-bp-bg border border-bp-border px-3 py-2"
                onClick={() => handleSelectCompany(company)}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Icon
                      icon="office"
                      size={12}
                      className="text-bp-primary-hover flex-shrink-0"
                    />
                    <span
                      className="text-sm truncate text-bp-text"
                    >
                      {company.name_english ?? company.name_nepali}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {company.district && (
                      <Tag
                        minimal
                        className="text-[10px] text-bp-text-muted"
                      >
                        {company.district}
                      </Tag>
                    )}
                    {company.director_count != null &&
                      company.director_count > 0 && (
                        <Tag minimal intent="primary" className="text-[10px]">
                          {company.director_count} directors
                        </Tag>
                      )}
                  </div>
                </div>
                {company.registration_number && (
                  <div
                    className="text-xs mt-1 text-bp-text-secondary"
                  >
                    Reg: {company.registration_number}
                    {company.pan ? ` | PAN: ${company.pan}` : ""}
                  </div>
                )}
              </Card>
            ))}
            {!isSearching &&
              searchResults?.items?.length === 0 && (
                <div className="text-xs py-2 text-center text-bp-text-secondary">
                  No companies found
                </div>
              )}
          </div>
        )}
      </div>

      {/* Tree / Empty state */}
      <div className="flex-1 overflow-y-auto p-3" style={{ scrollbarWidth: "thin" }}>
        {!selectedCompanyId ? (
          <NonIdealState
            icon="diagram-tree"
            title="Director Network"
            description="Select a company to explore its director network"
            className="bp6-dark mt-8"
          />
        ) : isLoadingDirectors ? (
          <NonIdealState
            icon="refresh"
            title="Loading..."
            description="Fetching shared director data"
            className="bp6-dark mt-8"
          />
        ) : directors && directors.length === 0 ? (
          <NonIdealState
            icon="warning-sign"
            title="No Directors Found"
            description="No director records available for this company"
            className="bp6-dark mt-8"
          />
        ) : (
          <Tree
            contents={treeNodes}
            onNodeExpand={handleNodeExpand}
            onNodeCollapse={handleNodeCollapse}
            onNodeClick={handleNodeClick}
            className="bp6-dark"
          />
        )}
      </div>
    </div>
  );
}
