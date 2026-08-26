sap.ui.require(
    [
        'sap/fe/test/JourneyRunner',
        'zvendorsearch/test/integration/FirstJourney',
		'zvendorsearch/test/integration/pages/SupplierSearchList',
		'zvendorsearch/test/integration/pages/SupplierSearchObjectPage'
    ],
    function(JourneyRunner, opaJourney, SupplierSearchList, SupplierSearchObjectPage) {
        'use strict';
        var JourneyRunner = new JourneyRunner({
            // start index.html in web folder
            launchUrl: sap.ui.require.toUrl('zvendorsearch') + '/index.html'
        });

       
        JourneyRunner.run(
            {
                pages: { 
					onTheSupplierSearchList: SupplierSearchList,
					onTheSupplierSearchObjectPage: SupplierSearchObjectPage
                }
            },
            opaJourney.run
        );
    }
);