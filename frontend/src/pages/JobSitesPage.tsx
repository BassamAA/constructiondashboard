import { useMemo, useState } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { fetchCustomers } from "../api/customers";
import {
  createJobSite,
  deleteJobSite,
  fetchJobSites,
  updateJobSite,
} from "../api/jobSites";

type FormState = {
  customerId: string;
  name: string;
  address: string;
  notes: string;
};

const initialForm: FormState = {
  customerId: "",
  name: "",
  address: "",
  notes: "",
};

export function JobSitesPage() {
  const queryClient = useQueryClient();
  const [formState, setFormState] = useState<FormState>(initialForm);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>("all");
  const [formError, setFormError] = useState<string | null>(null);
  const [editingSiteId, setEditingSiteId] = useState<number | null>(null);

  const { data: customers = [] } = useQuery({
    queryKey: ["customers"],
    queryFn: fetchCustomers,
  });

  const filterCustomerId =
    selectedCustomerId === "all" ? undefined : Number(selectedCustomerId);

  const { data: jobSites = [], isLoading } = useQuery({
    queryKey: ["job-sites", filterCustomerId ?? "all"],
    queryFn: () => fetchJobSites(filterCustomerId),
  });

  const createMutation = useMutation({
    mutationFn: createJobSite,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["job-sites"] });
      resetForm();
    },
    onError: (err: any) => {
      setFormError(err?.response?.data?.error ?? err?.message ?? "Failed to create job site");
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Parameters<typeof updateJobSite>[1] }) =>
      updateJobSite(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["job-sites"] });
      resetForm();
    },
    onError: (err: any) => {
      setFormError(err?.response?.data?.error ?? err?.message ?? "Failed to update job site");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteJobSite,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["job-sites"] });
      if (editingSiteId !== null) {
        resetForm();
      }
    },
  });

  const isSaving = createMutation.isPending || updateMutation.isPending;
  const isBusy = useMemo(
    () => isLoading || deleteMutation.isPending,
    [isLoading, deleteMutation.isPending],
  );

  function resetForm() {
    setFormState(initialForm);
    setEditingSiteId(null);
    setFormError(null);
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    const name = formState.name.trim();
    const customerIdValue = formState.customerId.trim();

    if (!customerIdValue) {
      setFormError("Choose a customer before saving the job site");
      return;
    }
    if (!name) {
      setFormError("Job site name is required");
      return;
    }

    const payload = {
      customerId: Number(customerIdValue),
      name,
      address: formState.address.trim() || undefined,
      notes: formState.notes.trim() || undefined,
    };

    if (editingSiteId === null) {
      createMutation.mutate(payload);
    } else {
      updateMutation.mutate({ id: editingSiteId, data: payload });
    }
  }

  function startEditing(siteId: number) {
    const site = jobSites.find((item) => item.id === siteId);
    if (!site) return;

    setFormState({
      customerId: String(site.customerId),
      name: site.name,
      address: site.address ?? "",
      notes: site.notes ?? "",
    });
    setSelectedCustomerId(String(site.customerId));
    setEditingSiteId(siteId);
    setFormError(null);
  }

  return (
    <section>
      <header>
        <h2>Job Sites</h2>
        <p>Manage delivery locations for each customer.</p>
      </header>

      <div className="section-card">
        <h3 style={{ marginTop: 0 }}>{editingSiteId ? "Edit job site" : "Add job site"}</h3>
        <form onSubmit={handleSubmit} className="form-grid two-columns">
          <label>
            Customer *
            <select
              value={formState.customerId}
              onChange={(event) =>
                setFormState((prev) => ({ ...prev, customerId: event.target.value }))
              }
              required
            >
              <option value="" disabled>
                Select customer
              </option>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Job site name *
            <input
              value={formState.name}
              onChange={(event) =>
                setFormState((prev) => ({ ...prev, name: event.target.value }))
              }
              placeholder="Airport expansion"
              required
            />
          </label>
          <label style={{ gridColumn: "1 / -1" }}>
            Address / Directions
            <textarea
              value={formState.address}
              onChange={(event) =>
                setFormState((prev) => ({ ...prev, address: event.target.value }))
              }
              placeholder="GPS or landmark information"
            />
          </label>
          <label style={{ gridColumn: "1 / -1" }}>
            Notes
            <textarea
              value={formState.notes}
              onChange={(event) =>
                setFormState((prev) => ({ ...prev, notes: event.target.value }))
              }
              placeholder="Gate codes, delivery windows, etc."
            />
          </label>
          <div style={{ gridColumn: "1 / -1", display: "flex", gap: 12 }}>
            <button type="submit" className="primary-button" disabled={isSaving || customers.length === 0}>
              {isSaving
                ? "Saving..."
                : editingSiteId === null
                  ? "Save job site"
                  : "Update job site"}
            </button>
            {editingSiteId !== null && (
              <button type="button" className="secondary-button" onClick={resetForm}>
                Cancel editing
              </button>
            )}
          </div>
          {customers.length === 0 && (
            <p className="error-text" style={{ gridColumn: "1 / -1" }}>
              Add a customer first before creating job sites.
            </p>
          )}
          {formError && (
            <div className="error-text" style={{ gridColumn: "1 / -1" }}>
              {formError}
            </div>
          )}
        </form>
      </div>

      <div className="section-card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ marginTop: 0 }}>Job sites</h3>
          <select
            value={selectedCustomerId}
            onChange={(event) => setSelectedCustomerId(event.target.value)}
          >
            <option value="all">All customers</option>
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.name}
              </option>
            ))}
          </select>
        </div>

        {isBusy ? (
          <p>Loading job sites…</p>
        ) : jobSites.length === 0 ? (
          <p>No job sites found for this filter.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Site</th>
                <th>Customer</th>
                <th>Address</th>
                <th>Notes</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {jobSites.map((site) => {
                const customer = customers.find((item) => item.id === site.customerId);
                return (
                  <tr key={site.id}>
                    <td>{site.name}</td>
                    <td>{customer?.name ?? site.customerId}</td>
                    <td>{site.address ?? "—"}</td>
                    <td>{site.notes ?? "—"}</td>
                    <td>
                      <div className="table-actions">
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() => startEditing(site.id)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() => deleteMutation.mutate(site.id)}
                          disabled={deleteMutation.isPending}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

export default JobSitesPage;
