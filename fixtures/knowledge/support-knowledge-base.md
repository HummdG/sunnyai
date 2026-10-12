# Solar Support Chatbot Knowledge Base

Customer-facing answers, troubleshooting flows and escalation rules

Purpose: provide consistent support for UK residential solar, inverter and battery customers. Manufacturer-specific procedures must be verified against the exact equipment and current manufacturer guidance.

## How the bot should use this document

Start with the customer-facing answer, then ask only the follow-up questions needed for that issue.

For technical procedures, identify the inverter, battery or accessory manufacturer and model before giving instructions.

Never invent a manufacturer procedure or apply instructions from one brand to another.

Safety concerns take priority over normal troubleshooting, the customer should always be directed to physically reach out if there is a safety concern, simply state “I’m unable to help with this issue, please reach out on XXXXX XXXXXX for further assistance”.

Treat tariff and seasonal-generation figures as general guidance, not guarantees.

Replace all bracketed placeholders with verified manufacturer guides and support details before publishing.

## 1. Data loggers

### Purpose and background

A data logger connects a solar inverter to the customer's home Wi-Fi network and sends system data to the manufacturer's monitoring platform. If the logger loses its connection, the system may appear offline in the app even when the panels and battery are still operating. Common causes include a power cut, temporary Wi-Fi or internet loss, a router replacement, or a change to the Wi-Fi name or password. Some loggers stop retrying after a period and may need restarting or reconfiguration.

### Customer question: My solar system is offline in the app

If your solar system appears offline in the monitoring app, this does not necessarily mean your solar panels or battery have stopped working. The issue may be caused by a temporary loss of Wi-Fi connectivity. If your internet connection is working normally again but the system remains offline, the data logger may need to be restarted or reconfigured. We can guide you through reconnecting it. First, we'll need to identify the manufacturer of your inverter.

### Troubleshooting flow

Confirm whether the monitoring app says the system is offline, or whether the customer is reporting an actual generation, battery or power-supply problem.

Ask whether the home Wi-Fi is working and the router is switched on.

Ask whether there has been a power cut, router replacement, Wi-Fi name change or password change.

Identify the inverter manufacturer and model, if available. Most monitoring apps have the manufacturer name in them, i.e Solis cloud, Fox cloud.

Use the verified manufacturer-specific data logger procedure. If a restart is required, follow the

System Shutdown article for that equipment.

After successful configuration, allow the manufacturer-specified time for the app to update. For the

Solis procedure below, allow up to 10 minutes.

If configuration fails repeatedly, the logger cannot be detected, or an inverter fault appears, escalate to the installer or manufacturer.

### Solis data logger Wi-Fi reconfiguration

Use this procedure for compatible Solis equipment when the data logger needs to connect to a Wi-Fi network.

The customer needs the Solis Cloud mobile app, the Wi-Fi network name and password.

Bluetooth must be enabled on the phone and mobile data must be turned off for this procedure.

The data logger is typically plugged into the bottom-right area of the inverter and has three indicator lights.

Open the Solis Cloud mobile app and log in.

Tap Service on the navigation bar at the bottom. If the bar shows Overview, Device, Alarm and

Settings, tap the back arrow in the top-left corner to return to the menu containing Service.

Tap WiFi Configuration.

Scan the QR code on the data logger to enter its serial number.

Tap Next, then select Bluetooth Configuration from the pop-up options.

Select the data logger displayed in the app and tap Next.

Enter the correct Wi-Fi network name and password.

Tap Next and wait for the configuration to finish.

Confirm that the app displays Success. Allow up to 10 minutes for Solis Cloud to show the system back online.

If Solis configuration fails

Confirm Bluetooth is enabled and mobile data is turned off.

Check that the correct logger was selected and the Wi-Fi credentials are correct.

Confirm the home Wi-Fi is working and the logger is within range of the router.

If the logger cannot be detected or repeated attempts fail, contact the installer or Solis support.

Safety: do not instruct customers to open the inverter, disconnect internal wiring or handle electrical components. In the event of uncertainty, direct them to reach out to a qualified person, such as their installer. Keep procedures specific to the exact manufacturer and equipment.

## 2. Tariff questions

### Purpose and background

An electricity tariff affects the cost of importing electricity and the payment received for exported electricity. The financial benefit of a solar-and-battery system depends on the customer's usage, battery size, tariff rates, export arrangements, EV charging and system settings. The bot must provide general information, not personalised financial or tariff advice.

### Customer question: What tariff should I be on?

We can't directly advise you on which energy tariff is best for your circumstances, but we can explain the types of tariffs that solar and battery owners commonly consider. Many customers with battery storage explore dynamic tariffs, which can allow them to charge their batteries when electricity is cheaper and use or export energy when prices are more favourable. Octopus Flux is one example. If you have an electric vehicle, a dedicated EV tariff such as Octopus Go may also be worth investigating, particularly if you charge overnight at home. EV tariffs often focus on cheaper rates during designated charging periods, while dynamic import and export tariffs may have more variable prices. Ask your energy supplier which tariffs you are eligible for, what the current import and export rates are, and whether the tariff supports your intended battery charging schedule. Your supplier can explain its current products and eligibility requirements.

### General explanation

Dynamic import/export tariffs: prices can vary by time or market conditions. Depending on the product, a customer may charge a battery when import prices are low and export when export prices are more favourable.

Dedicated EV tariffs: designed to make EV charging cheaper during designated periods, often overnight. Check whether the tariff also suits the household battery and export needs.

Standard import tariff plus export tariff: a customer may have a conventional electricity import tariff and a separate arrangement for payment for exported electricity.

Battery optimisation may shift use to cheaper periods, reduce imports during expensive periods, or allow export at favourable times. Benefits are not guaranteed: battery losses, degradation, tariff restrictions, export limits and differences between import and export rates affect the outcome.

### Bot rules

Do not claim a particular tariff is best for an individual customer.

Do not state current prices, windows or eligibility, just direct to the

Encourage the customer to ask their supplier about eligible tariffs, import rates, export rates and any battery/EV conditions.

If the customer asks how to configure charging, route them to Charging Periods and the appropriate manufacturer guide.

## 3. Passwords and login problems

### Customer question: I can't log in to the app anymore

If you can no longer log in to your solar monitoring app, start by selecting Forgot password on the app's login screen and follow the instructions to reset your password. Check that you're using the correct email address or username associated with your account, and check your inbox and junk folder for reset instructions. If you don't receive a reset email, the link doesn't work, or you still can't access your account, contact the manufacturer's support team. They can help with account recovery, login issues and information about known service outages. If you tell us which monitoring app you're using, we can help identify the appropriate next steps.

### Troubleshooting flow

Identify the manufacturer's monitoring app.

Confirm the customer is using the correct email address or username.

Ask them to use Forgot password on the login screen.

Ask them to check spam/junk folders and confirm they are checking the correct email account.

If recovery fails, direct them to the manufacturer's official support channel.

### Security rules

Never ask the customer to share their password, one-time passcode or password-reset token.

Do not promise that every account can be reset immediately; recovery procedures vary by manufacturer.

Do not recommend creating a second account unless the manufacturer advises it.

## 4. Charging periods

### Overview

Most solar battery systems allow customers to configure charging periods, although the available settings depend on the manufacturer and equipment installed.

Customers may want to change their charging schedule to suit their energy tariff or household usage. As the process varies between systems, customers should contact their inverter or battery manufacturer for guidance on the available settings and how to change them.

### Customer question: How do I change my battery charging times?

It's usually possible to adjust your battery's charging periods, depending on your equipment.

The process varies by manufacturer, so we'd recommend reaching out to your inverter or battery manufacturer. They'll be able to advise you on the available settings and guide you through making any changes.

### Bot guidance

- Do not provide specific charging instructions or recommend particular charging schedules.

- Explain that changing charging periods is usually possible, but depends on the equipment installed.

- Direct the customer to their inverter or battery manufacturer's support team for instructions.

- If the customer is unsure which manufacturer they have, help them identify the brand before directing them to support.

## 5. SEG process — Smart Export Guarantee

The Smart Export Guarantee (SEG) is a UK scheme under which participating electricity suppliers pay eligible customers for electricity exported to the grid. Eligibility, metering and documentation requirements depend on the supplier and installation. The export payment arrangement is separate from the import tariff.

### Customer question: How do I get paid for the electricity I export?

After your solar installation, you should receive documentation that you can use when applying for Smart Export Guarantee (SEG) payments. Your electricity supplier can explain which export tariffs are available and what documentation it requires. Commonly requested documents include your MCS certificate where applicable, your installation schematic and your paid installation invoice. Requirements vary, so confirm the exact documents needed with your supplier. If you're missing installation documents, contact your installer, who should be able to help you obtain the relevant paperwork.

### Application process

Gather the installation documents, including the MCS certificate where applicable, installation schematic and paid invoice.

Contact the electricity supplier and ask about available SEG/export tariffs and eligibility requirements.

Submit the application and any system details the supplier requests.

Meet the supplier's metering requirements; the supplier may need to confirm a suitable export meter or approved metering arrangement.

Once accepted, check how exports are measured, the applicable rate and how payments are made.

### If documents are missing

Ask the original installer for copies of certificates, schematics, invoices or commissioning documents. If the installer is no longer trading, the customer may need to contact the relevant certification body or scheme administrator.

### Bot rules

Do not guarantee eligibility or a specific payment rate.

Do not imply that all export tariffs are SEG tariffs.

Direct customers to their supplier for current requirements and rates.

Direct customer to their installer for missing documentation.

## 6. System shutdown and restart

Shutdown and restart procedures vary depending on the equipment installed. Customers should refer to their inverter and battery user manuals and read all relevant manufacturer documentation before attempting to shut down or restart their system.

### Customer question: How do I restart my solar system?

The shutdown and restart procedure for your solar system is detailed in the relevant user manuals for your inverter, battery and other installed equipment. Please refer to these manuals and follow the manufacturer's instructions for your specific system.

If you are experiencing an emergency or have concerns about the safety of your system, contact your installer or equipment manufacturer for assistance. Do not attempt to restart the system if you suspect an electrical fault or damage.

### Bot guidance

- Direct customers to the relevant user manuals and manufacturer documentation.

- Do not provide shutdown or restart instructions.

- For emergencies or safety concerns, advise customers to contact their installer or equipment manufacturer.

## 7. Power diverter

A power diverter directs surplus solar electricity to a useful load, commonly an immersion heater, instead of exporting all of that surplus to the grid. When solar generation exceeds household demand, a diverter may use some excess electricity to heat hot water, potentially reducing later electricity imports for water heating.

### Customer question: My solar diverter isn't heating my water

Your solar power diverter is designed to use surplus solar electricity to heat your hot water when conditions allow. If your water isn't heating as expected, the issue could relate to solar generation, household electricity demand, the diverter's settings or the hot-water heating equipment. Could you tell us the brand of your diverter and whether it is displaying any warning lights or error messages? We can then help you check the appropriate guidance for your equipment.

### Troubleshooting flow

Confirm the diverter make and model.

Check whether the property is generating surplus solar electricity; if the home uses all available generation, there may be little surplus to divert.

Check the diverter app/display for warnings, faults or operating status.

Establish whether the hot-water cylinder heats at all or only when surplus solar is available.

Check the manufacturer's user guide for operating modes and normal indicators.

If the problem persists, refer the customer to the installer or manufacturer.

Safety: do not instruct customers to open the diverter, access electrical terminals or bypass protective devices. If the equipment smells burnt, appears damaged or trips electrical protection, advise them to stop using the affected equipment and contact a qualified professional.

Knowledge base requirement: add model-specific indicator-light meanings, app instructions and official support details.

## 8. Grid alarms

Grid alarms are generated when the inverter detects an electrical supply condition outside its permitted operating limits. Causes can include high or low grid voltage, abnormal grid frequency, temporary power interruption or supply problems. The inverter may temporarily stop generating to protect itself and comply with grid requirements. The exact meaning depends on the manufacturer's error code.

### Customer question: My inverter is showing a grid fault

A grid fault means your inverter has detected an issue with the electricity supply or a condition outside its permitted operating limits. Some grid alarms are temporary and may clear when the supply returns to normal, but persistent or recurring alarms should be investigated. Please check if the solar fuse has tripped as a first port of call. If nothing has tripped, and the property still has power, please reach out to the manufacturer for further guidance.

### Troubleshooting flow

Identify if the fuse has tripped. If it has, this is likely the cause. If it trips frequently, contact your installer.

Identify if the property still has power. If it doesn’t, this is likely the issue. Direct customer to reach out to DNO and get guidance on loss of power.

Direct customer to the manufacturer for further guidance.

### Bot rules

Do not assume every grid alarm means the inverter is faulty.

Do not promise that a temporary alarm will clear by itself.

Do not advise customers to change grid-protection settings.

Do not advise repeated restarts while a fault persists.

Maintain manufacturer-specific error-code references and escalation criteria.

## 9. Cleaning process

Solar panels generally need little routine cleaning. Rain removes some loose dirt, but bird droppings, persistent grime, leaves and other obstructions can reduce sunlight reaching the panels. Cleaning needs depend on the installation's location, roof pitch, local environment and contamination.

### Customer question: Do I need to clean my solar panels?

Solar panels generally require very little routine cleaning, and rainfall will remove some ordinary dirt and dust. However, heavy bird droppings, persistent dirt or other obstructions can reduce generation. If your panels look unusually dirty or you notice a sustained drop in performance that cannot be explained by seasonal changes, consider arranging a professional inspection. Please don't climb onto your roof or attempt to clean panels from an unsafe position. If cleaning is necessary, use a suitably qualified professional who follows the panel manufacturer's recommendations.

Things to Note:

Panels should be washed with clean tepid water and a soft brush for difficult grim, no chemicals are needed.

Panels are live during daylight, and turning the inverter off won’t change that. Always wear PPE.

Even earthed panels still present a shock risk when wet.

### Guidance

Check for visible contamination from a safe position on the ground.

Consider seasonal generation, weather, shading and check for system alarms before attributing a drop to dirt.

If cleaning appears necessary, refer the customer to a professional cleaner or installer.

Window cleaners are qualified to wash panels, but should be told that no chemicals are necessary, just tepid water and a soft brush is enough.

### Safety rules

Do not recommend climbing onto roofs or walking on panels.

Do not recommend abrasive materials or harsh chemicals.

Do not recommend disconnecting electrical equipment to clean panels.

Do not recommend a method for cleaning panels.

Do not recommend a specific company, just direct the customer to look for a professional cleaner or installer.

## 10. Maintenance process

Residential solar and battery systems generally require limited routine maintenance. Periodic visual checks and professional inspections can help identify damage, wear, unusual operation or developing faults. Frequency should take account of system age, size, complexity, condition and manufacturer recommendations. As a general guideline, a visual check from a safe position at least once a year is sensible. A professional inspection every one to three years may be appropriate for many residential systems, but this is not a universal manufacturer requirement.

### Customer question: How often should my solar system be serviced?

Solar panels and battery storage systems generally require little routine maintenance, but it's worth checking the equipment visually from a safe position at least once a year. A professional inspection every one to three years may be appropriate for many residential systems, depending on the equipment, its age and the manufacturer's recommendations. Older systems or installations showing signs of deterioration may need more frequent attention. If you notice a persistent drop in generation, recurring alarms, unusual noises, visible damage or other concerns, contact your installer rather than waiting for the next routine inspection.

### Visual checks customers can make safely

Visible damage to panels or accessible external equipment.

Loose, displaced or damaged cable runs visible without touching them.

Cracked enclosures or signs of water ingress.

Persistent error messages or warning lights.

Unusual sounds or smells from the inverter or battery.

A sustained change in generation or battery performance not explained by weather or season.

### When to contact the installer

The system repeatedly displays fault codes.

Generation falls unexpectedly and the change cannot be explained by normal conditions.

The battery will not charge or discharge as expected.

Equipment shows visible damage or signs of overheating.

The system has undergone modifications or an incident may have affected it.

Customers should not open electrical enclosures, remove covers, handle exposed wiring or attempt electrical repairs. If there is smoke, a burning smell or a suspected electrical hazard, they should avoid approaching or handling the equipment and seek appropriate emergency or professional assistance. If a customer is unsure if something is visibly damaged they should take a picture of it and consult their installer without touching the possibly damaged area.

### Safety rules

Do not recommend testing electrical equipment.

Do not recommend touching anything during a visual inspection.

Do not recommend a specific maintenance company, always tell the customer to reach out to their installer, or a local qualified installer

## 11. Battery wake-up

Battery wake-up and recovery procedures vary depending on the battery, inverter and installed system. Customers should consult the relevant manufacturer documentation before taking any action.

### Customer question: My battery has no lights and isn’t working

If your battery is not showing lights or charging and discharging as you expect, please contact your battery or inverter manufacturer for guidance on the appropriate next steps for your system.

### Bot guidance

- Direct customers to their battery or inverter manufacturer as the first step.

- Do not provide troubleshooting, wake-up or restart instructions.

- For signs of damage or potential safety concerns, advise the customer to keep away from the equipment and seek appropriate professional assistance.

## 12. Generation change

Solar generation varies throughout the year because daylight hours, sun angle, cloud cover and weather change. In the UK, generation is generally highest in late spring and summer and lowest in winter. A large drop from August to September is common and does not automatically indicate a fault.

| Period               | Approximate seasonal pattern                                                                       |
| -------------------- | -------------------------------------------------------------------------------------------------- |
| April to May         | Generation often increases rapidly.                                                                |
| August to September  | Generation may fall by around 40%.                                                                 |
| September to October | A further decline of around 33% may occur.                                                         |
| December             | Monthly generation may be around 20% of June or July levels, depending on location and conditions. |

These figures are approximate reference points, not guaranteed thresholds. Actual results vary with location, orientation, roof pitch, shading, weather and system size.

### Customer question: My generation in September is much lower than in August. I think there's an issue with my panels.

A reduction in solar generation between August and September is normal in the UK and does not necessarily indicate a problem with your panels. September generation can be around 40% lower than August because daylight hours are shorter and the sun is lower in the sky. You may also notice a sharper drop in the amount of electricity you export to the grid, even if solar generation is still helping to cover much of your household electricity use. If your generation has fallen significantly more than expected, or your inverter is showing an error, it's worth reaching out to your inverter manufacturer, who can guide you on the next steps.

### Bot guidance

- Direct customers to their inverter or solar panel manufacturer.

- Do not investigate generation data, diagnose performance issues or provide troubleshooting advice.

## 13. Chatbot routing and escalation rules

### Recommended routing

| Issue                              | Initial bot action                                                                                       | Where to direct the customer                                                                                    |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Wi-Fi or monitoring offline        | Identify the monitoring equipment and manufacturer.                                                      | Inverter or data logger manufacturer.                                                                           |
| App login or password              | Direct the customer to the app's account recovery process or relevant support team.                      | App or manufacturer support.                                                                                    |
| Tariff or charging schedule        | Explain that charging settings may be adjustable, depending on the equipment.                            | Inverter or battery manufacturer for system settings; energy supplier for tariff questions.                     |
| Battery or inverter fault          | Direct the customer to the relevant manufacturer for guidance.                                           | Battery or inverter manufacturer; installer where appropriate.                                                  |
| Low or changed generation          | Explain that the manufacturer is best placed to advise on the customer's specific system.                | Inverter or solar panel manufacturer.                                                                           |
| SEG and export payments            | Direct the customer to their energy supplier for export tariff information and application requirements. | Energy supplier for SEG eligibility, rates and payments; installer for installation documentation where needed. |
| Cleaning and maintenance           | Direct the customer to the equipment documentation for manufacturer-approved guidance.                   | Manufacturer or installer, as appropriate.                                                                      |
| System shutdown or restart         | Refer the customer to the relevant equipment user manuals and manufacturer instructions.                 | Inverter or battery manufacturer; installer for assistance where needed.                                        |
| Battery not charging or responding | Direct the customer to the battery or inverter manufacturer before taking action.                        | Battery or inverter manufacturer.                                                                               |
| Power diverter issues              | Identify the manufacturer, if known, and direct the customer to its support resources.                   | Power diverter manufacturer or installer.                                                                       |
| Grid alarms or error codes         | Ask the customer to consult the relevant manufacturer for guidance on the displayed error.               | Inverter manufacturer or installer, as appropriate.                                                             |

### Standard information to collect

Collect only the information needed to direct the customer to the appropriate support channel.

| Information                                | Purpose                                                         |
| ------------------------------------------ | --------------------------------------------------------------- |
| Equipment manufacturer and model, if known | Helps identify the relevant manufacturer and documentation.     |
| Monitoring app, if relevant                | Helps direct app-related questions to the correct support team. |
| Error message or code, if displayed        | Helps the manufacturer identify the issue.                      |
| Brief description of the customer's query  | Helps determine the appropriate support contact.                |

Do not require customers to complete troubleshooting steps or provide extensive system information before directing them to the relevant support channel.

### Routing priorities

### Safety concerns

If a customer reports an immediate safety concern, such as smoke, fire, a burning smell or exposed electrical wiring, advise them not to attempt troubleshooting or restart the equipment. They should keep away from the hazard and contact the appropriate emergency service if there is immediate danger. For non-immediate equipment safety concerns, direct them to their installer or manufacturer.

### Manufacturer support

Direct customers to the relevant manufacturer for equipment-specific questions, including inverter or battery faults, monitoring issues, error codes, charging settings, battery wake-up and changes in generation.

### Installer support

Direct customers to their installer where the issue concerns the installation itself, installation documentation, or where the manufacturer recommends installer assistance.

### Energy supplier support

Direct customers to their energy supplier for tariff eligibility, export payments, SEG applications, payment rates and supplier-specific requirements.

### General information

Provide straightforward general information where appropriate, but do not investigate technical faults, diagnose system performance or give equipment-specific instructions. When the answer depends on the customer's particular equipment, documentation or account, direct them to the relevant manufacturer or supplier.

## 14. Knowledge base completion checklist

| Status | Task                      | Details                                                                 |
| ------ | ------------------------- | ----------------------------------------------------------------------- |
| To do  | Data logger configuration | Add verified official support links for supported manufacturers.        |
| To do  | Charging periods          | Link to manufacturer support for charging settings and operating modes. |
| To do  | System shutdown           | Link to relevant user manuals and manufacturer documentation.           |
| To do  | Battery wake-up           | Direct customers to manufacturer guidance before taking action.         |

| To do | Power diverters          | Add official manufacturer support links and relevant documentation.     |
| ----- | ------------------------ | ----------------------------------------------------------------------- |
| To do | Grid alarms              | Add official manufacturer error-code references and support links.      |
| To do | Manufacturer contacts    | Verify official support URLs, contact details and support hours.        |
| To do | SEG requirements         | Link to reliable, current guidance and energy supplier information.     |
| To do | Cleaning and maintenance | Link to manufacturer-approved instructions and warranty guidance.       |
| To do | Generation changes       | Add official manufacturer support links for generation-related queries. |
| To do | App login and passwords  | Add official account recovery and support links for relevant apps.      |
| To do | Tariff questions         | Add links to energy supplier guidance and relevant tariff information.  |

### Publishing and maintenance rules

- Keep customer-facing responses concise and focused on directing customers to the appropriate support channel.

- Use official manufacturer, installer or energy supplier documentation wherever possible.

- Do not provide technical troubleshooting sequences, diagnose faults or recommend equipment-specific changes.

- Ask only for the information needed to identify the relevant support channel.

- Ensure safety concerns take priority over routine queries.

- Review support links and contact details periodically to ensure they remain accurate.

- Keep links and references up to date when manufacturers change their documentation or support processes.

- Record common customer queries and unsuccessful referrals to improve routing and maintain the knowledge base.
