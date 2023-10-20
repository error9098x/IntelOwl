import React, { useEffect } from "react";
import { BsFillTrashFill, BsFillPlusCircleFill } from "react-icons/bs";
import { MdEdit, MdInfoOutline } from "react-icons/md";
import {
  FormGroup,
  Label,
  Container,
  Col,
  Row,
  FormText,
  Input,
  Spinner,
  Button,
  UncontrolledTooltip,
  Collapse,
} from "reactstrap";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Field,
  Form,
  FieldArray,
  useFormik,
  FormikProvider,
  ErrorMessage,
} from "formik";
import useTitle from "react-use/lib/useTitle";
import ReactSelect from "react-select";

import {
  ContentSection,
  IconButton,
  Loader,
  MultiSelectDropdownInput,
  addToast,
  selectStyles,
} from "@certego/certego-ui";

import {
  IoIosArrowDropdownCircle,
  IoIosArrowDropupCircle,
} from "react-icons/io";
import { useQuotaBadge } from "../../hooks";
import { usePluginConfigurationStore } from "../../stores";
import {
  TLP_CHOICES,
  TLP_COLOR_MAP,
  TLP_DESCRIPTION_MAP,
  scanTypes,
} from "../../constants";
import { scanMode, jobResultSection } from "../../constants/constants";
import { TLPTag, markdownToHtml, JobTag } from "../common";
import {
  RuntimeConfigurationModal,
  RecentScans,
  TagSelectInput,
} from "./utils";
import { createJob, createPlaybookJob } from "./api";
import { useGuideContext } from "../../contexts/GuideContext";
import { parseScanCheckTime } from "../plugins/utils/utils";

function DangerErrorMessage(fieldName) {
  return (
    <ErrorMessage
      name={fieldName}
      render={(msg) => <span className="text-danger">{msg}</span>}
    />
  );
}

// constants
const observableType2RegExMap = {
  domain: "^(?:[\\w-]{1,63}\\.)+[\\w-]{2,63}$",
  ip: "^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$",
  url: "^.{2,20}://.+$",
  hash: "^[a-zA-Z0-9]{32,}$",
};

const sanitizeObservable = (observable) =>
  observable.replaceAll("[", "").replaceAll("]", "").trim();

// Component
export default function ScanForm() {
  const [searchParams, _] = useSearchParams();
  const observableParam = searchParams.get("observable");
  const { guideState, setGuideState } = useGuideContext();

  /* Recent Scans states - inputValue is used to save the user typing (this state changes for each character that is typed), 
  recentScansInput is used for rendering RecentScans component only once per second
  */
  const [inputValue, setInputValue] = React.useState("");
  const [recentScansInput, setRecentScansInput] = React.useState("");

  React.useEffect(() => {
    if (guideState.tourActive) {
      setTimeout(() => {
        setGuideState({ run: true, stepIndex: 3 });
      }, 100);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  console.debug(
    `ScanForm rendered! Observable in GET param: ${observableParam}`,
  );

  const formik = useFormik({
    initialValues: {
      observableType: "observable",
      classification: "generic",
      observable_names: [""],
      files: [],
      analyzers: [],
      connectors: [],
      // playbook is an object, but if we use {} as default the UI component to select playbooks doesn's show the placeholder
      playbook: "",
      tlp: "AMBER",
      runtime_configuration: {},
      tags: [],
      scan_mode: scanMode.CHECK_PREVIOUS_ANALYSIS,
      analysisOptionValues: scanTypes.playbooks,
      scan_check_time: 24,
    },
    validate: (values) => {
      console.debug("validate - values");
      console.debug(values);

      const errors = {};

      if (analyzersError) {
        errors.analyzers = analyzersError;
      }
      if (connectorsError) {
        errors.connectors = connectorsError;
      }

      if (values.observableType === "file") {
        // this is an edge case
        if (
          !values.files ||
          values.files.length === 0 ||
          (values.files.length === 1 && values.files[0] === "")
        ) {
          errors.files = "required";
        }
      } else if (
        values.observable_names.filter((observable) => observable.length)
          .length === 0
      ) {
        // we cannot return a list of errors (one for each observable), or isValid doesn't work
        errors.observable_names = "observable(s) are required";
      }

      if (!TLP_CHOICES.includes(values.tlp)) {
        errors.tlp = "Invalid choice";
      }

      // check playbook or analyzer selections based on the user selection
      if (
        values.analysisOptionValues === scanTypes.playbooks &&
        Object.keys(values.playbook).length === 0
      ) {
        errors.playbook = "playbook required";
      }
      if (
        values.analysisOptionValues === scanTypes.analyzers_and_connectors &&
        values.analyzers.length === 0
      ) {
        errors.analyzers = "analyzers required";
      }

      console.debug("formik validation errors");
      console.debug(errors);
      return errors;
    },
    onSubmit: async (values) => {
      if (values.analysisOptionValues === scanTypes.playbooks) {
        startPlaybooks(values);
        return;
      }

      const formValues = {
        ...values,
        observable_names: values.observable_names.map((observable) =>
          sanitizeObservable(observable),
        ),
        tags_labels: values.tags.map((optTag) => optTag.value.label),
        analyzers: values.analyzers.map((x) => x.value),
        connectors: values.connectors.map((x) => x.value),
      };

      if (values.analyzers.length === 0) {
        addToast("Failed!", "Please select at least one analyzer", "danger");
        return;
      }

      /* We have 2 cases:
       1) use default config -> we need the runtime_configuration field has value {}
       2) custom config -> we need to add visualizers because it's required from the backend

      Note: we don't put visualizers in the editor because it could be very verbose
      */
      if (Object.keys(formValues.runtime_configuration).length) {
        formik.values.runtime_configuration.visualizers = {};
      }

      console.debug("ScanFrom - onSubmit - formValues");
      console.debug(formValues);

      try {
        const jobIds = await createJob(formValues);
        if (jobIds.length > 1) {
          setTimeout(() => navigate(`/jobs/`), 1000);
        } else {
          setTimeout(
            () =>
              navigate(`/jobs/${jobIds[0]}/${jobResultSection.VISUALIZER}/`),
            1000,
          );
        }
      } catch (e) {
        // handled inside createJob
      } finally {
        refetchQuota();
        formik.setSubmitting(false);
      }
    },
  });

  const [isAdvancedSettingsOpen, toggleAdvancedSettings] =
    React.useState(false);

  // page title
  useTitle("IntelOwl | Scan", { restoreOnUnmount: true });

  // router navigation
  const navigate = useNavigate();

  // use custom hooks
  const [{ MonthBadge, TotalBadge, QuotaInfoIcon }, refetchQuota, _quota] =
    useQuotaBadge();

  // API/ store
  const [
    analyzersLoading,
    connectorsLoading,
    playbooksLoading,
    analyzersError,
    connectorsError,
    playbooksError,
    analyzers,
    connectors,
    playbooks,
  ] = usePluginConfigurationStore((state) => [
    state.analyzersLoading,
    state.connectorsLoading,
    state.playbooksLoading,
    state.analyzersError,
    state.connectorsError,
    state.playbooksError,
    state.analyzers,
    state.connectors,
    state.playbooks,
  ]);

  const analyzersGrouped = React.useMemo(() => {
    const grouped = {
      ip: [],
      hash: [],
      domain: [],
      url: [],
      generic: [],
      file: [],
    };
    analyzers.forEach((obj) => {
      if (obj.type === "file") {
        grouped.file.push(obj);
      } else {
        obj.observable_supported.forEach((clsfn) => grouped[clsfn].push(obj));
      }
    });
    return grouped;
  }, [analyzers]);

  const playbooksGrouped = React.useMemo(() => {
    const grouped = {
      ip: [],
      hash: [],
      domain: [],
      url: [],
      generic: [],
      file: [],
    };
    playbooks.forEach((obj) => {
      // filter on basis of type
      obj.type.forEach((clsfn) => grouped[clsfn].push(obj));
    });
    console.debug("Playbooks", grouped);
    return grouped;
  }, [playbooks]);

  const analyzersOptions = React.useMemo(
    () =>
      analyzersGrouped[formik.values.classification]
        .map((v) => ({
          isDisabled: !v.verification.configured || v.disabled,
          value: v.name,
          label: (
            <div
              id={`analyzer${v.name}`}
              className="d-flex justify-content-start align-items-start flex-column"
            >
              <div className="d-flex justify-content-start align-items-baseline flex-column">
                <div>{v.name}&nbsp;</div>
                <div className="small text-start text-muted">
                  {markdownToHtml(v.description)}
                </div>
              </div>
              {!v.verification.configured && (
                <div className="small text-danger">
                  ⚠ {v.verification.details}
                </div>
              )}
            </div>
          ),
          labelDisplay: v.name,
        }))
        .sort((a, b) =>
          // eslint-disable-next-line no-nested-ternary
          a.isDisabled === b.isDisabled ? 0 : a.isDisabled ? 1 : -1,
        ),
    [analyzersGrouped, formik.values.classification],
  );
  const connectorOptions = React.useMemo(
    () =>
      connectors
        .map((v) => ({
          isDisabled: !v.verification.configured || v.disabled,
          value: v.name,
          label: (
            <div className="d-flex justify-content-start align-items-start flex-column">
              <div className="d-flex justify-content-start align-items-baseline flex-column">
                <div>{v.name}&nbsp;</div>
                <div className="small text-start text-muted">
                  {markdownToHtml(v.description)}
                </div>
              </div>
              {!v.verification.configured && (
                <div className="small text-danger">
                  ⚠ {v.verification.details}
                </div>
              )}
            </div>
          ),
          labelDisplay: v.name,
        }))
        .sort((a, b) =>
          // eslint-disable-next-line no-nested-ternary
          a.isDisabled === b.isDisabled ? 0 : a.isDisabled ? 1 : -1,
        ),
    [connectors],
  );

  const playbookOptions = (classification) =>
    playbooksGrouped[classification]
      .map((v) => ({
        isDisabled: v.disabled,
        value: v.name,
        label: (
          <div className="d-flex justify-content-start align-items-start flex-column">
            <div className="d-flex justify-content-start align-items-baseline flex-column">
              <div>{v.name}&nbsp;</div>
              <div className="small text-left text-muted">
                {markdownToHtml(v.description)}
              </div>
            </div>
          </div>
        ),
        labelDisplay: v.name,
        tags: v.tags.map((tag) => ({
          value: tag,
          label: <JobTag tag={tag} />,
        })),
        tlp: v.tlp,
        scan_mode: `${v.scan_mode}`,
        scan_check_time: v.scan_check_time,
      }))
      .sort((a, b) =>
        // eslint-disable-next-line no-nested-ternary
        a.isDisabled === b.isDisabled ? 0 : a.isDisabled ? 1 : -1,
      );

  const ValidatePlaybooks = React.useCallback(
    (values) => {
      const errors = {};
      if (playbooksError) {
        errors.playbook = playbooksError;
      }
      if (Object.keys(values.playbook).length === 0) {
        return `Please select a playbook!`;
      }
      if (values.classification === "file") {
        if (!values.files || values.files.length === 0) {
          errors.files = "required";
        }
      } else if (values.observable_names && values.observable_names.length) {
        if (!TLP_CHOICES.includes(values.tlp)) {
          errors.tlp = "Invalid choice";
        }
      }
      return errors;
    },
    [playbooksError],
  );

  const startPlaybooks = React.useCallback(
    async (values) => {
      const formValues = {
        ...values,
        observable_names: values.observable_names.map((observable) =>
          sanitizeObservable(observable),
        ),
        tlp: values.tlp,
        tags_labels: values.tags.map((optTag) => optTag.value.label),
        playbook: values.playbook.value,
        scan_mode: values.scan_mode,
        scan_check_time: values.scan_check_time,
      };

      const errors = ValidatePlaybooks(values);
      if (Object.keys(errors).length !== 0) {
        addToast("Failed!", JSON.stringify(errors), "danger");
        return;
      }

      try {
        const jobIds = await createPlaybookJob(formValues);

        if (jobIds.length > 1) {
          setTimeout(() => navigate(`/jobs/`), 1000);
        } else {
          setTimeout(
            () =>
              navigate(`/jobs/${jobIds[0]}/${jobResultSection.VISUALIZER}/`),
            1000,
          );
        }
      } catch (e) {
        // handled inside createPlaybookJob
      } finally {
        refetchQuota();
      }
    },
    [navigate, refetchQuota, ValidatePlaybooks],
  );

  const updateAdvancedConfig = (tags, tlp, _scanMode, scanCheckTime) => {
    formik.setFieldValue("tags", tags, false);
    formik.setFieldValue("tlp", tlp, false);
    formik.setFieldValue("scan_mode", _scanMode, false);
    // null for playbooks with force new
    console.debug(`scanCheckTime : ${scanCheckTime}`);
    if (scanCheckTime) {
      formik.setFieldValue(
        "scan_check_time",
        parseScanCheckTime(scanCheckTime),
        false,
      );
    }
  };

  // wait the user terminated to typing and then perform the request to recent scans
  React.useEffect(() => {
    const timer = setTimeout(() => {
      setRecentScansInput(sanitizeObservable(inputValue));
      console.debug(inputValue);
    }, 1000);
    return () => clearTimeout(timer);
  }, [inputValue]);

  const updateSelectedObservable = (observableValue, index) => {
    if (index === 0) {
      const oldClassification = formik.values.classification;
      let newClassification = "generic";
      Object.entries(observableType2RegExMap).forEach(
        ([typeName, typeRegEx]) => {
          if (new RegExp(typeRegEx).test(sanitizeObservable(observableValue))) {
            newClassification = typeName;
          }
        },
      );
      formik.setFieldValue("classification", newClassification, false);
      // in case a playbook is available and i changed classification or no playbook is selected i select a playbook
      if (
        playbookOptions(newClassification).length > 0 &&
        (oldClassification !== newClassification ||
          Object.keys(formik.values.playbook).length === 0) &&
        formik.values.analysisOptionValues === scanTypes.playbooks
      ) {
        formik.setFieldValue(
          "playbook",
          playbookOptions(newClassification)[0],
          false,
        );
        updateAdvancedConfig(
          playbookOptions(newClassification)[0].tags,
          playbookOptions(newClassification)[0].tlp,
          playbookOptions(newClassification)[0].scan_mode,
          playbookOptions(newClassification)[0].scan_check_time,
        );
      }
    }
    const observableNames = formik.values.observable_names;
    observableNames[index] = observableValue;
    formik.setFieldValue("observable_names", observableNames, false);
    setInputValue(observableValue);
  };

  const updateSelectedPlaybook = (playbook) => {
    formik.setFieldValue("playbook", playbook, false);
    updateAdvancedConfig(
      playbook.tags,
      playbook.tlp,
      playbook.scan_mode,
      playbook.scan_check_time,
    );
  };

  const [scanType, setScanType] = React.useState(
    formik.values.analysisOptionValues,
  );

  const updateAnalysisOptionValues = (newAnalysisType) => {
    if (
      scanType === scanTypes.playbooks &&
      newAnalysisType === scanTypes.analyzers_and_connectors
    ) {
      setScanType(newAnalysisType);
      // reset playbook
      formik.setFieldValue("playbook", formik.initialValues.playbook, false);
      // reset advanced configuration
      updateAdvancedConfig(
        formik.initialValues.tags,
        formik.initialValues.tlp,
        formik.initialValues.scan_mode,
        "1 00:00:00",
      );
    }
    if (
      scanType === scanTypes.analyzers_and_connectors &&
      newAnalysisType === scanTypes.playbooks
    ) {
      setScanType(newAnalysisType);
      // if an observable or file is loaded set a default playbook
      if (
        (formik.values.observable_names.length &&
          formik.values.observable_names[0] !== "") ||
        (formik.values.files.length &&
          formik.values.files[0] !== "" &&
          Object.keys(formik.values.playbook).length === 0)
      ) {
        updateSelectedPlaybook(
          playbookOptions(formik.values.classification)[0],
        );
      }
    }
  };

  // useEffect for setting the default playbook if an observableor a file is loaded before playbooks are fetched
  useEffect(() => {
    if (
      (formik.values.observable_names.length &&
        formik.values.observable_names[0] !== "") ||
      (formik.values.files.length &&
        formik.values.files[0] !== "" &&
        Object.keys(formik.values.playbook).length === 0 &&
        formik.values.analysisOptionValues === scanTypes.playbooks)
    ) {
      updateSelectedPlaybook(playbookOptions(formik.values.classification)[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playbooksLoading]);

  useEffect(() => {
    if (observableParam) {
      updateSelectedObservable(observableParam, 0);
      if (formik.playbook) updateSelectedPlaybook(formik.playbook);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [observableParam, playbooksLoading]);

  /* With the setFieldValue the validation and rerender don't work properly: the last update seems to not trigger the validation
  and leaves the UI with values not valid, for this reason the scan button is disabled, but if the user set focus on the UI the last
  validation trigger and start scan is enabled. To avoid this we use this hook that force the validation when the form values change.
  
  This hook is the reason why we can disable the validation in the setFieldValue method (3rd params).
  */
  React.useEffect(() => {
    formik.validateForm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formik.values]);

  const [isModalOpen, setModalOpen] = React.useState(false);
  const toggleModal = React.useCallback(
    () => setModalOpen((o) => !o),
    [setModalOpen],
  );

  console.debug(`classification: ${formik.values.classification}`);
  console.debug("formik");
  console.debug(formik);
  return (
    <Container fluid className="d-flex justify-content-center">
      {/* Form */}
      <ContentSection
        id="ScanForm"
        className="col-lg-8 col-xl-7 mt-3 bg-body shadow"
      >
        <div className="mt-4 d-flex justify-content-between">
          <h3 id="scanpage" className="fw-bold">
            Scan&nbsp;
            {formik.values.classification === "file" ? "Files" : "Observables"}
          </h3>
          <div className="mt-1">
            {/* Quota badges */}
            <MonthBadge className="me-2 text-larger" />
            <TotalBadge className="ms-2 me-3 text-larger" />
            <QuotaInfoIcon />
          </div>
        </div>
        <hr />
        <FormikProvider value={formik}>
          <Form onSubmit={formik.handleSubmit}>
            <Row>
              <div className="col-sm-3 col-form-label" />
              <FormGroup className="mb-0 mt-2 d-flex col-sm-9">
                {["observable", "file"].map((ch) => (
                  <FormGroup check inline key={`observableType__${ch}`}>
                    <Col>
                      <Field
                        as={Input}
                        id={`observableType__${ch}`}
                        type="radio"
                        name="observableType"
                        value={ch}
                        onClick={(event) => {
                          formik.setFieldValue(
                            "observableType",
                            event.target.value,
                            false,
                          );
                          formik.setFieldValue(
                            "classification",
                            event.target.value === "observable"
                              ? "generic"
                              : "file",
                          );
                          formik.setFieldValue("observable_names", [""], false);
                          formik.setFieldValue("files", [""], false);
                          formik.setFieldValue(
                            "analysisOptionValues",
                            scanTypes.playbooks,
                            false,
                          );
                          setScanType(scanTypes.playbooks);
                          formik.setFieldValue("playbook", "", false); // reset
                          formik.setFieldValue("analyzers", [], false); // reset
                          formik.setFieldValue("connectors", [], false); // reset
                        }}
                      />
                      <Label check>
                        {ch === "observable"
                          ? "observable (domain, IP, URL, HASH, etc...)"
                          : "file"}
                      </Label>
                    </Col>
                  </FormGroup>
                ))}
              </FormGroup>
            </Row>
            {formik.values.observableType === "observable" ? (
              <FieldArray
                name="observable_names"
                render={(arrayHelpers) => (
                  <FormGroup row>
                    <Label
                      id="selectobservable"
                      className="required"
                      sm={3}
                      for="observable_name"
                    >
                      Observable Value(s)
                    </Label>
                    <Col sm={9}>
                      <div className="invalid-feedback d-block">
                        {formik.errors.no_observables}
                      </div>
                      {formik.values.observable_names &&
                      formik.values.observable_names.length > 0
                        ? formik.values.observable_names.map((name, index) => (
                            <div
                              className="py-2 d-flex"
                              key={`observable_names.${index + 0}`}
                            >
                              <Col sm={11} className="pe-3">
                                <Field
                                  as={Input}
                                  type="text"
                                  placeholder="google.com, 8.8.8.8, https://google.com, 1d5920f4b44b27a802bd77c4f0536f5a"
                                  id={`observable_names.${index}`}
                                  name={`observable_names.${index}`}
                                  className="input-dark"
                                  invalid={
                                    Boolean(
                                      formik.errors.observable_names &&
                                        formik.errors.observable_names[index],
                                    ) &&
                                    formik.touched.observable_names &&
                                    formik.touched.observable_names[index]
                                  }
                                  onChange={(e) =>
                                    updateSelectedObservable(
                                      e.target.value,
                                      index,
                                    )
                                  }
                                />
                                {DangerErrorMessage("observable_names")}
                              </Col>
                              <Button
                                color="primary"
                                className="mx-auto rounded-1 text-larger col-sm-1"
                                onClick={() => arrayHelpers.remove(index)}
                              >
                                <BsFillTrashFill />
                              </Button>
                            </div>
                          ))
                        : null}
                      <Row className="my-2 pt-0">
                        <Button
                          color="primary"
                          size="sm"
                          className="mx-auto rounded-1 mx-auto col-sm-auto"
                          onClick={() => arrayHelpers.push("")}
                        >
                          <BsFillPlusCircleFill /> Add new value
                        </Button>
                      </Row>
                    </Col>
                  </FormGroup>
                )}
              />
            ) : (
              <FormGroup row>
                <Label className="required" sm={3} for="file">
                  File(s)
                </Label>
                <Col sm={9}>
                  <Input
                    type="file"
                    id="file"
                    name="file"
                    onChange={(event) => {
                      formik.setFieldValue(
                        "files",
                        event.currentTarget.files,
                        false,
                      );
                      formik.setFieldValue("classification", "file", false);
                      if (
                        Object.keys(formik.values.playbook).length === 0 &&
                        playbookOptions("file").length > 0 &&
                        formik.values.analysisOptionValues ===
                          scanTypes.playbooks
                      ) {
                        formik.setFieldValue(
                          "playbook",
                          playbookOptions("file")[0],
                          false,
                        );
                        updateAdvancedConfig(
                          playbookOptions("file")[0].tags,
                          playbookOptions("file")[0].tlp,
                          playbookOptions("file")[0].scan_mode,
                          playbookOptions("file")[0].scan_check_time,
                        );
                      }
                    }}
                    className="input-dark"
                    multiple
                  />
                </Col>
              </FormGroup>
            )}
            <hr />
            <Row>
              <div className="col-sm-3 col-form-label" />
              <FormGroup
                className="d-flex col-sm-9"
                style={{ marginTop: "10px" }}
              >
                {Object.values(scanTypes).map((type_) => (
                  <FormGroup check inline key={`analysistype__${type_}`}>
                    <Col>
                      <Field
                        as={Input}
                        id={`analysistype__${type_}`}
                        type="radio"
                        name="analysisOptionValues"
                        value={type_}
                        onClick={() => updateAnalysisOptionValues(type_)}
                      />
                      <Label check>{type_}</Label>
                    </Col>
                  </FormGroup>
                ))}
              </FormGroup>
            </Row>
            {scanType === scanTypes.analyzers_and_connectors && (
              <>
                <FormGroup row>
                  <Label sm={3} for="analyzers">
                    Select Analyzers
                  </Label>
                  <Col sm={9}>
                    <Loader
                      loading={analyzersLoading}
                      error={analyzersError}
                      render={() => (
                        <MultiSelectDropdownInput
                          options={analyzersOptions}
                          value={formik.values.analyzers}
                          onChange={(v) =>
                            formik.setFieldValue("analyzers", v, false)
                          }
                        />
                      )}
                    />
                    {DangerErrorMessage("analyzers")}
                  </Col>
                </FormGroup>
                <FormGroup row>
                  <Label sm={3} for="connectors">
                    Select Connectors
                  </Label>
                  <Col sm={9}>
                    {!(connectorsLoading || connectorsError) && (
                      <MultiSelectDropdownInput
                        options={connectorOptions}
                        value={formik.values.connectors}
                        onChange={(v) =>
                          formik.setFieldValue("connectors", v, false)
                        }
                      />
                    )}
                  </Col>
                </FormGroup>
                <FormGroup row>
                  <Label sm={3} for="scanform-runtimeconf-editbtn">
                    Runtime Configuration
                  </Label>
                  <Col sm={9}>
                    <IconButton
                      id="scanform-runtimeconf-editbtn"
                      Icon={MdEdit}
                      title="Edit runtime configuration"
                      titlePlacement="top"
                      size="sm"
                      color="tertiary"
                      disabled={
                        !(
                          formik.values.analyzers.length > 0 ||
                          formik.values.connectors.length > 0
                        )
                      }
                      onClick={toggleModal}
                    />
                    {isModalOpen && (
                      <RuntimeConfigurationModal
                        isOpen={isModalOpen}
                        toggle={toggleModal}
                        formik={formik}
                      />
                    )}
                  </Col>
                </FormGroup>
              </>
            )}
            {scanType === scanTypes.playbooks && (
              <FormGroup row className="mb-4">
                <Label id="selectplugins" sm={3} htmlFor="playbook">
                  Select Playbook
                </Label>
                <Col sm={9}>
                  <Loader
                    loading={playbooksLoading}
                    error={playbooksError}
                    render={() => (
                      <ReactSelect
                        isClearable={false}
                        options={playbookOptions(formik.values.classification)}
                        styles={selectStyles}
                        value={formik.values.playbook}
                        onChange={(v) => updateSelectedPlaybook(v)}
                      />
                    )}
                  />
                  {DangerErrorMessage("playbook")}
                </Col>
              </FormGroup>
            )}

            <hr />
            <Button
              size="sm"
              onClick={() => toggleAdvancedSettings(!isAdvancedSettingsOpen)}
              color="primary"
              className="mt-2"
            >
              <span className="me-1">Advanced settings</span>
              {isAdvancedSettingsOpen ? (
                <IoIosArrowDropupCircle />
              ) : (
                <IoIosArrowDropdownCircle />
              )}
            </Button>
            <Collapse isOpen={isAdvancedSettingsOpen}>
              <FormGroup row>
                <Label sm={3} id="scanform-tagselectinput">
                  Tags
                </Label>
                <Col sm={9}>
                  <TagSelectInput
                    id="scanform-tagselectinput"
                    selectedTags={formik.values.tags}
                    setSelectedTags={(v) =>
                      formik.setFieldValue("tags", v, false)
                    }
                  />
                </Col>
              </FormGroup>
              <FormGroup row>
                <Label sm={3}>TLP</Label>
                <Col sm={9}>
                  <div>
                    {TLP_CHOICES.map((ch) => (
                      <FormGroup inline check key={`tlpchoice__${ch}`}>
                        <Label check for={`tlpchoice__${ch}`}>
                          <TLPTag value={ch} />
                        </Label>
                        <Field
                          as={Input}
                          id={`tlpchoice__${ch}`}
                          type="radio"
                          name="tlp"
                          value={ch}
                          invalid={formik.errors.tlp && formik.touched.tlp}
                          onChange={formik.handleChange}
                        />
                      </FormGroup>
                    ))}
                  </div>
                  <FormText>
                    <span
                      style={{ color: `${TLP_COLOR_MAP[formik.values.tlp]}` }}
                    >
                      {TLP_DESCRIPTION_MAP[formik.values.tlp].replace(
                        "TLP: ",
                        "",
                      )}
                    </span>
                  </FormText>
                </Col>
              </FormGroup>
              <FormGroup row className="mt-2">
                <Label sm={3}>Scan configuration</Label>
                <Col sm={9}>
                  <FormGroup check key="checkchoice__check_all">
                    <Field
                      as={Input}
                      id="checkchoice__check_all"
                      type="radio"
                      name="scan_mode"
                      value={scanMode.CHECK_PREVIOUS_ANALYSIS}
                      onChange={formik.handleChange}
                    />
                    <div className="d-flex align-items-center">
                      <Label
                        check
                        for="checkchoice__check_all"
                        className="col-8"
                      >
                        Do not execute if a similar analysis is currently
                        running or reported without fails
                      </Label>
                      <div className="col-4 d-flex align-items-center">
                        H:
                        <div className="col-4 mx-1">
                          <Field
                            as={Input}
                            id="checkchoice__check_all__minutes_ago"
                            type="number"
                            name="scan_check_time"
                            onChange={formik.handleChange}
                          />
                        </div>
                        <div className="col-2">
                          <MdInfoOutline id="minutes-ago-info-icon" />
                          <UncontrolledTooltip
                            target="minutes-ago-info-icon"
                            placement="right"
                            fade={false}
                            innerClassName="p-2 border border-info text-start text-nowrap md-fit-content"
                          >
                            <span>
                              Max age (in hours) for the similar analysis.
                              <br />
                              The default value is 24 hours (1 day).
                              <br />
                              Empty value takes all the previous analysis.
                            </span>
                          </UncontrolledTooltip>
                        </div>
                      </div>
                    </div>
                  </FormGroup>
                  <FormGroup check key="checkchoice__force_new">
                    <Field
                      as={Input}
                      id="checkchoice__force_new"
                      type="radio"
                      name="scan_mode"
                      value={scanMode.FORCE_NEW_ANALYSIS}
                      onChange={formik.handleChange}
                    />
                    <Label check for="checkchoice__force_new">
                      Force new analysis
                    </Label>
                  </FormGroup>
                </Col>
              </FormGroup>
            </Collapse>

            <FormGroup row className="mt-3">
              <Button
                id="startScan"
                type="submit"
                /* dirty return True if values are different then default
                 we cannot run the validation on mount or we get an infinite loop.
                */
                disabled={
                  !formik.dirty || !formik.isValid || formik.isSubmitting
                }
                color="primary"
                size="lg"
                outline
                className="mx-auto rounded-0 col-sm-3 order-sm-5"
              >
                {formik.isSubmitting && <Spinner size="sm" />}Start Scan
              </Button>
            </FormGroup>
          </Form>
        </FormikProvider>
      </ContentSection>
      {/* Recent Scans */}
      <ContentSection
        id="RecentScans"
        className="col-lg-4 col-xl-4 mt-3 mx-3 bg-body shadow"
      >
        <RecentScans
          classification={formik.values.classification}
          param={
            formik.values.files.length
              ? formik.values.files[0]
              : recentScansInput
          }
        />
      </ContentSection>
    </Container>
  );
}
