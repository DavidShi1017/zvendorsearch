import MessageBox from "sap/m/MessageBox";
import BusyIndicator from "sap/ui/core/BusyIndicator";
import Context from "sap/ui/model/odata/v4/Context";
import ODataModel from "sap/ui/model/odata/v4/ODataModel";
import ODataContextBinding from "sap/ui/model/odata/v4/ODataContextBinding";

// Service schema namespace (from $metadata) — needed to address the bound actions.
const NS = "com.sap.gateway.srvd.zui_vo_mysupplier.v0001";

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
    const sSupplierId = oCtx.getProperty("Supplier") as string;
    const oModel = oCtx.getModel() as ODataModel;

    BusyIndicator.show(0);
    try {
        // 1. Deep-create the prefilled UPDATE request (active $self).
        const oCreate = oModel.bindContext(`${NS}.createUpdateRequest(...)`, oCtx) as ODataContextBinding;
        oCreate.setParameter("SupplierId", sSupplierId);
        await oCreate.invoke();
        const oActive = oCreate.getBoundContext() as Context;
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
