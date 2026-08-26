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
 * 2. Puts it straight into a draft via the entity's own draft `Edit` action.
 * 3. Navigates to the draft (IsActiveEntity=false) → the object page opens in EDIT mode,
 *    so the requestor lands editable with no second "Edit" click.
 *
 * NB: we cannot use this.editFlow.editDocument here — editFlow is scoped to the *current*
 * (SupplierSearch, read-only) page, so it can't find an edit action for VendorUpdateRequest.
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
        // canonical path — so rebuild the canonical path from the key to address the entity.
        const sUuid = oActive.getProperty("RequestUuid") as string;

        // 2. Turn the active request into a draft via the `Edit` action. Invoke with bIgnoreETag=true
        //    so UI5 sends If-Match:* — this avoids a separate round-trip just to read the ETag first
        //    (every round-trip is ~2s over the dev proxy to the remote system).
        const oEdit = oModel.bindContext(
            `/UpdateRequest(RequestUuid=${sUuid},IsActiveEntity=true)/${NS}.Edit(...)`
        ) as ODataContextBinding;
        oEdit.setParameter("PreserveChanges", false);
        await oEdit.invoke(undefined, true);
        BusyIndicator.hide();

        // eslint-disable-next-line no-console
        console.log("[SupplierEdit] draft ready for request:", sUuid);

        // 3. Navigate to the draft (shares the key, IsActiveEntity=false) → object page opens in EDIT mode.
        this.routing.navigateToRoute("VendorUpdateRequestObjectPage", {
            key: `RequestUuid=${sUuid},IsActiveEntity=false`
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
