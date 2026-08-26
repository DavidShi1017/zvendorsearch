import MessageBox from "sap/m/MessageBox";
import BusyIndicator from "sap/ui/core/BusyIndicator";
import Context from "sap/ui/model/odata/v4/Context";
import ODataModel from "sap/ui/model/odata/v4/ODataModel";
import ODataContextBinding from "sap/ui/model/odata/v4/ODataContextBinding";

// Service schema namespace (from $metadata) — needed to address the bound actions.
const NS = "com.sap.gateway.srvd.zui_vo_mysupplier.v0001";

function normalizeSupplierId(sValue: string): string {
    const sTrimmed = sValue.trim();
    if (/^\d+$/.test(sTrimmed)) {
        return sTrimmed.padStart(10, "0");
    }
    return sTrimmed;
}

/**
 * FE custom action handler for the Supplier Object Page "Edit" button (App① UPDATE entry).
 *
 * 1. Deep-creates a prefilled UPDATE request from the current supplier (createUpdateRequest → active $self).
 * 2. Navigates to the returned request using its runtime IsActiveEntity flag.
 *    If backend already created a draft, we go directly to that draft.
 *
 * NB: do not force a second Edit(...) call here; some backend validations can reject it
 * for incomplete source master data (e.g. mandatory postal/email), while navigation to
 * the created request still works.
 *
 * `this` is the FE V4 ExtensionAPI (routing / getBindingContext).
 */
export async function onEditSupplier(this: {
    getBindingContext: () => Context;
    routing: { navigateToRoute: (route: string, params: object) => void };
}): Promise<void> {
    const oCtx = this.getBindingContext();
    const sRawSupplier =
        (oCtx.getProperty("Supplier") as string | undefined) ??
        (oCtx.getProperty("SupplierId") as string | undefined) ??
        (oCtx.getProperty("BusinessPartner") as string | undefined) ??
        (oCtx.getProperty("BusinessPartnerId") as string | undefined);
    const oModel = oCtx.getModel() as ODataModel;

    if (!sRawSupplier || !sRawSupplier.trim()) {
        MessageBox.error("Could not determine Supplier ID from the selected row.");
        return;
    }

    const sRawSupplierId = sRawSupplier.trim();
    const sNormalizedSupplierId = normalizeSupplierId(sRawSupplierId);
    const aSupplierIdCandidates =
        sNormalizedSupplierId === sRawSupplierId
            ? [sRawSupplierId]
            : [sNormalizedSupplierId, sRawSupplierId];

    BusyIndicator.show(0);
    try {
        // 1. Deep-create the prefilled UPDATE request.
        // createUpdateRequest is bound to Collection(UpdateRequestType), not to ZSUPPLIER_VO.
        let oActive: Context | null = null;
        let oLastError: unknown;
        for (const sSupplierId of aSupplierIdCandidates) {
            try {
                const oCreate = oModel.bindContext(`/UpdateRequest/${NS}.createUpdateRequest(...)`) as ODataContextBinding;
                oCreate.setParameter("SupplierId", sSupplierId);
                await oCreate.invoke();
                oActive = oCreate.getBoundContext() as Context;
                break;
            } catch (e) {
                oLastError = e;
                // eslint-disable-next-line no-console
                console.warn("[SupplierEdit] createUpdateRequest failed for SupplierId:", sSupplierId, e);
            }
        }

        if (!oActive) {
            throw oLastError;
        }

        // The action-result context's path is a deferred-operation path, not the entity's
        // canonical path — so rebuild the canonical key from returned properties.
        const sUuid = oActive.getProperty("RequestUuid") as string;
        const bIsActive = Boolean(oActive.getProperty("IsActiveEntity"));
        BusyIndicator.hide();

        // eslint-disable-next-line no-console
        console.log("[SupplierEdit] request ready:", sUuid, "IsActiveEntity=", bIsActive);

        // 2. Navigate to the created request. If backend returned a draft, this opens directly in draft context.
        this.routing.navigateToRoute("VendorUpdateRequestObjectPage", {
            key: `RequestUuid=${sUuid},IsActiveEntity=${bIsActive}`
        });
    } catch (e) {
        BusyIndicator.hide();
        // eslint-disable-next-line no-console
        console.error("[SupplierEdit] failed:", e);
        MessageBox.error(
            "Could not open the update request in edit mode:\n" +
                ((e as { message?: string })?.message ?? String(e))
        );
    }
}
