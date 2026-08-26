import MessageBox from "sap/m/MessageBox";
import BusyIndicator from "sap/ui/core/BusyIndicator";
import Context from "sap/ui/model/odata/v4/Context";
import ODataModel from "sap/ui/model/odata/v4/ODataModel";
import ODataContextBinding from "sap/ui/model/odata/v4/ODataContextBinding";

// Service schema namespace (from $metadata) — needed to address the bound actions.
const NS = "com.sap.gateway.srvd.zui_vo_mysupplier.v0001";

type ODataErrorPayload = {
    error?: {
        message?: string;
        details?: Array<{ message?: string }>;
        innererror?: {
            ErrorDetails?: {
                "@SAP__common.TransactionId"?: string;
                "@SAP__common.Timestamp"?: string;
            };
        };
    };
};

function formatBackendError(e: unknown): string {
    const sFallback = (e as { message?: string })?.message ?? String(e);
    const oPayload = (e as { error?: ODataErrorPayload["error"] })?.error;
    if (!oPayload) {
        return sFallback;
    }

    const aLines: string[] = [];
    if (oPayload.message) {
        aLines.push(oPayload.message);
    }

    if (Array.isArray(oPayload.details)) {
        for (const oDetail of oPayload.details) {
            if (oDetail?.message) {
                aLines.push(oDetail.message);
            }
        }
    }

    const oErrorDetails = oPayload.innererror?.ErrorDetails;
    if (oErrorDetails?.["@SAP__common.TransactionId"]) {
        aLines.push(`TransactionId: ${oErrorDetails["@SAP__common.TransactionId"]}`);
    }
    if (oErrorDetails?.["@SAP__common.Timestamp"]) {
        aLines.push(`Timestamp: ${oErrorDetails["@SAP__common.Timestamp"]}`);
    }

    return aLines.length > 0 ? aLines.join("\n") : sFallback;
}

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
 *    so the requestor lands editable with no second "Edit" click (FE V4 sets ui>/isEditable=true).
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
        // eslint-disable-next-line no-console
        console.info("[SupplierEdit] source row:", {
            Supplier: oCtx.getProperty("Supplier"),
            SupplierName: oCtx.getProperty("SupplierName"),
            Email: oCtx.getProperty("Email"),
            PostalCode: oCtx.getProperty("PostalCode"),
            Country: oCtx.getProperty("Country")
        });

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

        // 2. Turn the active request into a draft via the `Edit` action so the object page
        //    opens in edit mode (FE V4 ui>/isEditable becomes true on the draft context).
        //    Invoke with bIgnoreETag=true so UI5 sends If-Match:* (skips a separate ETag read).
        if (bIsActive) {
            const oEdit = oModel.bindContext(
                `/UpdateRequest(RequestUuid=${sUuid},IsActiveEntity=true)/${NS}.Edit(...)`
            ) as ODataContextBinding;
            oEdit.setParameter("PreserveChanges", false);
            await oEdit.invoke(undefined, true);
            // eslint-disable-next-line no-console
            console.log("[SupplierEdit] draft ready for request:", sUuid);
        }

        // 3. Navigate to the draft (IsActiveEntity=false) → the object page opens in EDIT mode.
        this.routing.navigateToRoute("VendorUpdateRequestObjectPage", {
            key: `RequestUuid=${sUuid},IsActiveEntity=false`
        });
    } catch (e) {
        BusyIndicator.hide();
        // eslint-disable-next-line no-console
        console.error("[SupplierEdit] failed:", e);
        const sBackendError = formatBackendError(e);
        MessageBox.error(
            "Could not open the update request in edit mode:\n" +
                sBackendError
        );
    }
}
