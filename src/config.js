const baseURL = "rehabranger.ai";

export const getServiceUrl = (activityData) => {
  return {
    EXERCISE_SERVICE: `https://${activityData?.tenant}.${baseURL}/exercise-service`,
    USER_SERVICE: `https://${activityData?.tenant}.${baseURL}/user-service`,
  };
};
